# Backend Patterns

> Scope: When the task involves server-side logic, error handling, logging, configuration, or structuring backend services.

## Core Principles
- Operational errors (network, bad input) are expected — handle them. Programming errors (null reference) are bugs — fix them
- Logs are for investigating production problems, not for local debugging
- Configuration comes from the environment, never hardcoded — 12-Factor App
- External input is hostile until proven otherwise — validate everything at the edge
- Functions do one thing. Services coordinate functions. Controllers delegate to services

## DO (Mandatory Practices)

### Error Handling
- Classify errors: Operational (retry/report) vs Programmer (fix the bug)
- Create a custom error hierarchy: AppError → ValidationError, NotFoundError, AuthError
- Operational errors: log + return a friendly message to the client
- Programming errors: log + crash (in dev), log + generic 500 (in prod)
- Centralize error handling in middleware/interceptors — not in every endpoint
- Include context in the error: `new NotFoundError('User', { id: userId })`

### Logging
- **ERROR**: something broke, requires human action (DB down, payment failed)
- **WARN**: abnormal but recoverable situation (retry succeeded, rate limit approaching)
- **INFO**: significant business events (user created, order placed, deploy completed)
- **DEBUG**: details for troubleshooting (query params, cache hit/miss) — off in prod
- Structure logs as JSON: `{ level, message, timestamp, requestId, userId, ...context }`
- Include request_id in every log to correlate the request lifecycle
- Never log: passwords, tokens, credit cards, PII without masking

### Environment & Config
- All config comes from environment variables — zero hardcoded values
- Validate config at startup: if a required variable is missing, crash immediately with a clear message
- Group config by domain: `DB_HOST`, `DB_PORT`, `DB_NAME` | `REDIS_URL` | `SMTP_HOST`
- Sensible defaults for development: works with `docker compose up` without a manual .env
- Never commit .env — commit .env.example with placeholder values

### Input Validation
- Validate at the edge (controller/handler) before passing to the service layer
- Use schema validation (Zod, Joi, class-validator): declare the schema, validate automatically
- Sanitize strings: trim whitespace, normalize unicode, escape HTML if needed
- Validate types, formats, ranges, and business rules in separate layers
- Reject invalid input with 400/422 and specific error details

### Service Layer
- 1 service = 1 business domain (UserService, OrderService, PaymentService)
- Services do not know about HTTP (no req/res) — they receive and return domain objects
- Services call repositories for data, never direct queries
- Transactions in the service layer — controllers do not manage transactions
- Dependencies injected (constructor injection), not imported directly

### Async Operations
- Operations > 500ms: move to a background job/queue
- Retry with exponential backoff: 1s, 2s, 4s, 8s, max 3-5 attempts
- Idempotency keys for operations that must not duplicate (payments, email sends)
- Dead letter queue for jobs that fail after max retries
- Explicit timeout on every external call (HTTP, DB, cache): default 5s, adjust by context

## DON'T (Anti-Patterns)

- **Swallow errors**: `catch(e) {}` — always log or re-throw
- **God service**: one service with 50+ methods. Split by responsibility
- **Magic strings**: `if (status === 'active')` — use typed enums/constants
- **Business logic in the controller**: a controller only validates input, calls the service, formats the response
- **Log and throw**: `logger.error(e); throw e;` — the error handler above logs it again. Pick one
- **Retry without backoff**: immediate retry in a loop = DDoS on a service that is already struggling
- **Sync for everything**: sending email in the request cycle blocks the response. Use a queue
- **Config at runtime**: `if (process.env.NODE_ENV === 'production')` scattered throughout the code. Centralize in a config module
- **Trust input**: `const userId = req.params.id` straight into SQL without validating the type
- **Console.log in production**: use a structured logger with levels

## Concrete Examples

### Error Handling Hierarchy
```typescript
// DON'T
try {
  const user = await db.findUser(id);
} catch (e) {
  res.status(500).json({ error: 'Something went wrong' });
}

// DO
class AppError extends Error {
  constructor(message, statusCode, code, details) { ... }
}
class NotFoundError extends AppError {
  constructor(resource, criteria) {
    super(`${resource} not found`, 404, 'NOT_FOUND', criteria);
  }
}
// In service:
const user = await userRepo.findById(id);
if (!user) throw new NotFoundError('User', { id });
// In error middleware:
app.use((err, req, res, next) => {
  if (err instanceof AppError) {
    logger.warn({ err, requestId: req.id });
    return res.status(err.statusCode).json({ error: err.toJSON() });
  }
  logger.error({ err, requestId: req.id });
  res.status(500).json({ error: { code: 'INTERNAL', message: 'Internal error' } });
});
```

### Config Validation
```typescript
// DON'T: process.env.DB_HOST scattered through the code, silent failure if undefined

// DO: validate at startup
const config = validateConfig({
  DB_HOST: { required: true },
  DB_PORT: { required: true, type: 'number', default: 5432 },
  LOG_LEVEL: { enum: ['error','warn','info','debug'], default: 'info' },
});
// The app crashes at startup if config is invalid — fail fast
```

## Pre-Delivery Checklist
- [ ] Error handling centralized in middleware (not in every endpoint)
- [ ] Custom error hierarchy with semantic status codes and codes
- [ ] Structured logs (JSON) with request_id in every log
- [ ] Zero hardcoded secrets — everything via environment variables
- [ ] Config validated at startup with fail-fast
- [ ] Input validated with a schema at the edge (controller)
- [ ] Slow operations in a background queue (not in the request cycle)
- [ ] Timeout defined on every external call
- [ ] .env.example committed, .env in .gitignore
- [ ] Zero console.log — structured logger everywhere
