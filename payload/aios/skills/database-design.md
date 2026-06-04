# Database Design

> Scope: When the task involves data modeling, schemas, queries, migrations, or database choice.

## Core Principles
- Schema is a contract — think of it as the data's API. Changes break consumers
- Normalize first, denormalize on purpose when performance demands it
- Indexes are the #1 performance lever — but every index has a write cost
- Migrations are irreversible in production — treat them with the same care as a deploy
- Data outlives code — today's schema decisions are tomorrow's legacy

## DO (Mandatory Practices)

### Schema Design
- Start normalized (3NF). Denormalize only when query performance justifies it with real data
- Primary keys: UUID v7 (timestamp-ordered) or bigint auto-increment. Never business data as PK
- Mandatory timestamps: `created_at`, `updated_at` on every table
- Soft delete with a `deleted_at` timestamp when data cannot be lost (compliance, audit)
- Use enums/check constraints in the DB — do not rely only on application validation
- Name tables in plural, columns in singular, everything snake_case

### Indexing Strategy
- Index on every FK (foreign key) — no exceptions
- Index on columns used in frequent WHERE, ORDER BY, JOIN
- Composite index: most selective column first (high cardinality)
- Covering index when the query only needs the indexed columns
- Monitor slow queries (slow query log) and add indexes with real data
- Do not create "just in case" indexes — every index degrades INSERT/UPDATE

### Migrations
- One migration per logical change — do not group unrelated changes
- Migrations should be reversible: define `up()` and `down()` explicitly
- Never edit a migration already executed in production — create a new migration
- Destructive migrations (drop column, drop table) in 2 phases: 1) stop using, 2) remove
- Test the migration with realistic data volume (not just an empty schema)
- Add an index in a separate migration (can be slow on large tables — use CONCURRENTLY)

### ORM vs Raw SQL
- ORM for simple CRUD and standard queries — productivity and safety
- Raw SQL for complex queries (CTEs, window functions, aggregations)
- Never build SQL with string concatenation — always use parameterized queries
- Use a query builder as a middle ground when the ORM is limited but raw SQL is overkill

### Relationships
- Define FKs with explicit ON DELETE (CASCADE, SET NULL, or RESTRICT — never silent default)
- Many-to-many: always an explicit junction table (never arrays of IDs)
- Self-referencing: limit depth or use a recursive CTE
- Polymorphic associations: prefer a table per type over `*_type` + `*_id` columns

## DON'T (Anti-Patterns)

- **N+1 Queries:** never iterate results running 1 query per item. Use JOIN or IN clause
- **Missing indexes on FKs:** JOIN/WHERE on an FK without an index = full table scan
- **EAV (Entity-Attribute-Value):** a table with (entity_id, key, value) for everything. Use JSONB if you need flexibility
- **Over-Normalization:** 15 JOINs to render 1 screen. Denormalize frequently-read data
- **God Table:** a table with 50+ columns. Split by domain/context
- **SELECT \*:** specify columns — avoid transferring unnecessary data
- **Long transactions:** prolonged locks degrade concurrency. Minimize transaction scope
- **Business logic in stored procedures:** harder to test, version, and debug. Keep logic in the application
- **Null as a business value:** do not use NULL to mean "not applicable". Use an enum or an explicit default value

## Concrete Examples

### N+1 Problem
```sql
-- DON'T: 1 query + N queries
SELECT * FROM orders WHERE user_id = 1;
-- for each order:
SELECT * FROM order_items WHERE order_id = ?;  -- N extra queries

-- DO: 1 query with JOIN
SELECT o.*, oi.*
FROM orders o
JOIN order_items oi ON oi.order_id = o.id
WHERE o.user_id = 1;

-- DO: 2 queries with IN
SELECT * FROM orders WHERE user_id = 1;
SELECT * FROM order_items WHERE order_id IN (1, 2, 3);
```

### Migration Safety
```sql
-- DON'T: drop column directly
ALTER TABLE users DROP COLUMN legacy_field;

-- DO: 2-phase approach
-- Migration 1: deploy code that does not use legacy_field
-- Migration 2 (after confirming no code uses it):
ALTER TABLE users DROP COLUMN legacy_field;
```

### Schema Naming
```sql
-- DON'T: Table: User, Column: firstName, FK: tbl_orders_usr_id
-- DO:    Table: users, Column: first_name, FK: user_id
```

## Pre-Delivery Checklist
- [ ] Every table has a primary key (UUID v7 or bigint)
- [ ] created_at and updated_at present in every table
- [ ] Index on every foreign key
- [ ] ON DELETE explicitly defined on every FK
- [ ] Zero N+1 queries — verify with query logging
- [ ] Migrations with up() and down() defined
- [ ] No migration edited after running in production
- [ ] Parameterized queries (zero string concatenation in SQL)
- [ ] Tables named in plural, columns in snake_case
- [ ] JSONB only when the schema is genuinely flexible (not as a workaround)
