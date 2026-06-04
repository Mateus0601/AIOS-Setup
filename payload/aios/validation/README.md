# AIOS Schema Validation System

Sistema de validação de schemas JSON para o activity-log.json do AIOS.

## Estrutura

```
~/.claude/aios/
├── schemas/
│   ├── activity-log/
│   │   ├── activities.schema.json
│   │   ├── discussions.schema.json
│   │   ├── decisions.schema.json
│   │   └── tasks.schema.json
│   └── common/
│       └── enums.json
└── validation/
    ├── validate.js
    └── README.md
```

## Schemas

### activities.schema.json
Validação de atividades dos agentes.

**Tier 1 (required, bloqueia com ERROR):**
- `id`: integer >= 1
- `agent`: enum ["ultron", "vigil", "forge", "aegis", "system"]
- `action`: string não-vazio
- `timestamp`: string ISO8601
- `project`: string não-vazio

**Tier 3 (optional, aviso WARNING):**
- `detail`: string

### discussions.schema.json
Validação de discussões entre agentes.

**Tier 1 (required):**
- `id`: integer >= 1
- `from`: enum (agentes + "all")
- `to`: enum (agentes + "all")
- `topic`: string não-vazio
- `message`: string não-vazio
- `timestamp`: string ISO8601
- `project`: string não-vazio

### decisions.schema.json
Validação de decisões tomadas.

**Tier 1 (required):**
- `id`: integer >= 1
- `agent`: enum (agentes)
- `decision`: string não-vazio
- `timestamp`: string ISO8601
- `project`: string não-vazio

**Tier 3 (optional):**
- `justification`: string
- `alternatives`: array of strings

### tasks.schema.json
Validação de tarefas do sistema.

**Tier 1 (required):**
- `id`: integer >= 1
- `task`: string não-vazio
- `assignedBy`: enum (agentes)
- `assignedTo`: enum (agentes)
- `status`: enum ["pending", "in_progress", "done", "blocked"]
- `timestamp`: string ISO8601
- `project`: string não-vazio

**Tier 3 (optional):**
- `priority`: enum ["baixa", "media", "alta", "critica"]
- `completedAt`: string ISO8601 ou null

## Validador

### Uso

```bash
node ~/.claude/aios/validation/validate.js ~/.claude/aios/activity-log.json
```

### Exit Codes

- `0`: Validação passou (ou apenas warnings Tier 3)
- `1`: Validação falhou (erros Tier 1 encontrados)

### Output

O validador exibe:
- **[ERROR]** para violações Tier 1 (campos obrigatórios)
- **[WARNING]** para violações Tier 3 (campos opcionais)
- Caminho completo do campo com problema (ex: `activities[44].action`)
- Resumo final: X errors, Y warnings

### Implementação

- **ZERO dependências npm** - apenas Node.js nativo (fs, path, process)
- Validação completa de tipos, enums, patterns, ranges
- Suporta arrays, objetos aninhados, múltiplos tipos
- JSON Schema Draft 7 compatível (simplificado)

## Tier System

**Tier 1 - CRITICAL:** Campos obrigatórios para funcionamento do sistema. Violação = ERROR, exit code 1.

**Tier 3 - OPTIONAL:** Campos opcionais/recomendados. Violação = WARNING, exit code 0.

**Tier 2 - AUTOCORRECTION:** (Fase futura) Campos que podem ser auto-corrigidos.

## Backups

O validador NÃO modifica arquivos. Para migrações/correções:

1. Criar backup: `cp activity-log.json activity-log.backup-YYYYMMDD-HHMMSS.json`
2. Fazer correções necessárias
3. Rodar validador para confirmar

## Integração ao Workflow AIOS

### Pre-commit Hook (Recomendado)

```bash
#!/bin/bash
# .git/hooks/pre-commit

if node ~/.claude/aios/validation/validate.js ~/.claude/aios/activity-log.json; then
  echo "✅ Activity log validation passed"
  exit 0
else
  echo "❌ Activity log validation failed"
  echo "Fix errors before committing"
  exit 1
fi
```

### CI/CD Pipeline

```yaml
# .github/workflows/validate.yml
- name: Validate activity log
  run: node ~/.claude/aios/validation/validate.js ~/.claude/aios/activity-log.json
```

### Uso Programático

```javascript
const { SchemaValidator } = require('./validate.js');
const validator = new SchemaValidator();
validator.validate(data, schemas);
const exitCode = validator.report();
```

## Exemplos de Saída

### Validação com Sucesso

```
═══════════════════════════════════════════════════════════════
                  VALIDATION REPORT
═══════════════════════════════════════════════════════════════

✅ All validations passed!

───────────────────────────────────────────────────────────────
Summary: 0 errors, 0 warnings
═══════════════════════════════════════════════════════════════
```

### Validação com Erros

```
═══════════════════════════════════════════════════════════════
                  VALIDATION REPORT
═══════════════════════════════════════════════════════════════

🔴 ERRORS (Tier 1 violations):
   [ERROR] activities[1].agent: expected one of [ultron, vigil, forge, aegis, system], got "invalid-agent"
   [ERROR] activities[2].action: missing required field
   [ERROR] activities[3].timestamp: does not match pattern ^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}

⚠️  WARNINGS (Tier 3 violations):
   [WARNING] decisions[5].justification: missing required field

───────────────────────────────────────────────────────────────
Summary: 3 errors, 1 warnings
═══════════════════════════════════════════════════════════════
```

## Migração Realizada

**Data:** 2026-02-11

**Correções aplicadas:**
- Entry id 44: `"type": "exec"` → `"action": "implementou_feature"` + adicionado `"project": "aios-dashboard"`
- Entry id 45: `"type": "checkpoint"` → `"action": "checkpoint_usuario"` + adicionado `"project": "multi-projeto"`

**Resultado:** 0 errors, 0 warnings

**Backup criado:** `activity-log.backup-20260211-224949.json`
