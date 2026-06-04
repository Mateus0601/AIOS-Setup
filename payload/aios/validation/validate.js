#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// ─────────────────────────────────────────────────────────────
// Minimal local $ref resolver (single source of truth for enums)
//
// This validator does NOT pull a full JSON Schema lib (zero npm deps by design).
// It supports the one $ref form we use: a relative file path + JSON-pointer into
// "definitions", e.g. {"$ref": "../common/enums.json#/definitions/agentEnum"}.
// The referenced fragment is loaded and merged in-place so enums.json stays the
// SINGLE SOURCE OF TRUTH while remaining enforced at validation time.
// ─────────────────────────────────────────────────────────────
function resolveRefs(node, baseDir, cache) {
  if (Array.isArray(node)) {
    return node.map(n => resolveRefs(n, baseDir, cache));
  }
  if (node && typeof node === 'object') {
    if (typeof node.$ref === 'string') {
      const [relPath, pointer] = node.$ref.split('#');
      if (!relPath || !pointer) {
        throw new Error(`Unsupported $ref (need path#/pointer): ${node.$ref}`);
      }
      const absPath = path.resolve(baseDir, relPath);
      if (!cache[absPath]) {
        cache[absPath] = JSON.parse(fs.readFileSync(absPath, 'utf8'));
      }
      // Walk the JSON pointer (e.g. /definitions/agentEnum)
      let target = cache[absPath];
      for (const seg of pointer.split('/').filter(Boolean)) {
        const key = seg.replace(/~1/g, '/').replace(/~0/g, '~');
        target = target?.[key];
        if (target === undefined) {
          throw new Error(`$ref pointer not found: ${node.$ref}`);
        }
      }
      // Resolve nested refs inside the target, then merge any sibling keys
      // (e.g. tier/description) that sit alongside the $ref.
      const resolvedTarget = resolveRefs(target, path.dirname(absPath), cache);
      const siblings = {};
      for (const [k, v] of Object.entries(node)) {
        if (k !== '$ref') siblings[k] = resolveRefs(v, baseDir, cache);
      }
      return { ...resolvedTarget, ...siblings };
    }
    const out = {};
    for (const [k, v] of Object.entries(node)) {
      out[k] = resolveRefs(v, baseDir, cache);
    }
    return out;
  }
  return node;
}

// Validator class
class SchemaValidator {
  constructor() {
    this.errors = [];
    this.warnings = [];
  }

  validateType(value, type, fieldPath) {
    if (type === 'integer') {
      if (!Number.isInteger(value)) {
        return `expected integer, got ${typeof value}`;
      }
    } else if (type === 'string') {
      if (typeof value !== 'string') {
        return `expected string, got ${typeof value}`;
      }
    } else if (type === 'array') {
      if (!Array.isArray(value)) {
        return `expected array, got ${typeof value}`;
      }
    } else if (Array.isArray(type)) {
      // Multiple types allowed (e.g., ["string", "null"])
      const isValid = type.some(t => {
        if (t === 'null') return value === null;
        if (t === 'integer') return Number.isInteger(value);
        return typeof value === t;
      });
      if (!isValid) {
        return `expected one of [${type.join(', ')}], got ${typeof value}`;
      }
    } else {
      if (typeof value !== type) {
        return `expected ${type}, got ${typeof value}`;
      }
    }
    return null;
  }

  validateProperty(value, schema, fieldPath) {
    const issues = [];
    const tier = schema.tier || 1;

    // Type validation
    if (schema.type) {
      const typeError = this.validateType(value, schema.type, fieldPath);
      if (typeError) {
        issues.push({ tier, message: typeError });
      }
    }

    // Enum validation
    if (schema.enum && !schema.enum.includes(value)) {
      issues.push({
        tier,
        message: `expected one of [${schema.enum.join(', ')}], got "${value}"`
      });
    }

    // String validations
    if (typeof value === 'string') {
      if (schema.minLength && value.length < schema.minLength) {
        issues.push({ tier, message: `string too short (min: ${schema.minLength})` });
      }
      if (schema.pattern) {
        const regex = new RegExp(schema.pattern);
        if (!regex.test(value)) {
          issues.push({ tier, message: `does not match pattern ${schema.pattern}` });
        }
      }
    }

    // Number validations
    if (typeof value === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) {
        issues.push({ tier, message: `below minimum value (${schema.minimum})` });
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        issues.push({ tier, message: `above maximum value (${schema.maximum})` });
      }
    }

    // Array validations
    if (Array.isArray(value) && schema.items) {
      value.forEach((item, idx) => {
        const itemIssues = this.validateProperty(item, schema.items, `${fieldPath}[${idx}]`);
        issues.push(...itemIssues);
      });
    }

    return issues;
  }

  validateEntry(entry, schema, arrayName, index) {
    const entryPath = `${arrayName}[${index}]`;
    const issues = [];

    // Check required fields
    if (schema.required) {
      for (const field of schema.required) {
        if (!(field in entry)) {
          const tier = schema.properties[field]?.tier || 1;
          issues.push({
            tier,
            path: `${entryPath}.${field}`,
            message: 'missing required field'
          });
        }
      }
    }

    // Validate each property
    for (const [field, value] of Object.entries(entry)) {
      const fieldSchema = schema.properties?.[field];
      const fieldPath = `${entryPath}.${field}`;

      if (!fieldSchema) {
        if (schema.additionalProperties === false) {
          issues.push({
            tier: 3,
            path: fieldPath,
            message: 'unknown field (not in schema)'
          });
        }
        continue;
      }

      const propIssues = this.validateProperty(value, fieldSchema, fieldPath);
      propIssues.forEach(issue => {
        issues.push({ ...issue, path: fieldPath });
      });
    }

    return issues;
  }

  validate(data, schemas) {
    const arrayTypes = ['activities', 'discussions', 'decisions', 'tasks'];

    for (const arrayType of arrayTypes) {
      const entries = data[arrayType] || [];
      const schema = schemas[arrayType];

      if (!schema) {
        console.warn(`⚠️  No schema found for ${arrayType}`);
        continue;
      }

      entries.forEach((entry, index) => {
        const issues = this.validateEntry(entry, schema, arrayType, index);

        issues.forEach(issue => {
          if (issue.tier === 1) {
            this.errors.push({ path: issue.path, message: issue.message });
          } else if (issue.tier === 3) {
            this.warnings.push({ path: issue.path, message: issue.message });
          }
        });
      });
    }
  }

  report() {
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('                  VALIDATION REPORT');
    console.log('═══════════════════════════════════════════════════════════════\n');

    if (this.errors.length > 0) {
      console.log('🔴 ERRORS (Tier 1 violations):');
      this.errors.forEach(err => {
        console.log(`   [ERROR] ${err.path}: ${err.message}`);
      });
      console.log('');
    }

    if (this.warnings.length > 0) {
      console.log('⚠️  WARNINGS (Tier 3 violations):');
      this.warnings.forEach(warn => {
        console.log(`   [WARNING] ${warn.path}: ${warn.message}`);
      });
      console.log('');
    }

    if (this.errors.length === 0 && this.warnings.length === 0) {
      console.log('✅ All validations passed!\n');
    }

    console.log('───────────────────────────────────────────────────────────────');
    console.log(`Summary: ${this.errors.length} errors, ${this.warnings.length} warnings`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    return this.errors.length === 0 ? 0 : 1;
  }
}

// Main
function main() {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error('Usage: node validate.js <activity-log.json>');
    process.exit(1);
  }

  const logPath = path.resolve(args[0]);
  // Always use the AIOS directory for schemas, regardless of where the log file is
  const aiosDir = path.join(process.env.HOME || process.env.USERPROFILE, '.claude', 'aios');
  const schemasDir = path.join(aiosDir, 'schemas', 'activity-log');

  // Load activity log
  let data;
  try {
    const content = fs.readFileSync(logPath, 'utf8');
    data = JSON.parse(content);
  } catch (err) {
    console.error(`❌ Failed to read/parse ${logPath}: ${err.message}`);
    process.exit(1);
  }

  // Load schemas
  const schemas = {};
  const schemaFiles = {
    activities: 'activities.schema.json',
    discussions: 'discussions.schema.json',
    decisions: 'decisions.schema.json',
    tasks: 'tasks.schema.json'
  };

  const refCache = {};
  for (const [type, filename] of Object.entries(schemaFiles)) {
    const schemaPath = path.join(schemasDir, filename);
    try {
      const content = fs.readFileSync(schemaPath, 'utf8');
      const parsed = JSON.parse(content);
      // Resolve cross-file $ref (enums.json single source) relative to the schema dir
      schemas[type] = resolveRefs(parsed, schemasDir, refCache);
    } catch (err) {
      console.error(`❌ Failed to load schema ${filename}: ${err.message}`);
      process.exit(1);
    }
  }

  // Validate
  const validator = new SchemaValidator();
  validator.validate(data, schemas);
  const exitCode = validator.report();

  process.exit(exitCode);
}

if (require.main === module) {
  main();
}

module.exports = { SchemaValidator };
