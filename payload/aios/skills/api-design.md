# API Design

> Scope: When the task involves creating or modifying REST APIs, GraphQL, endpoints, or communication contracts between systems.

## Core Principles
- An API is a public contract — backward compatibility is sacred after publication
- Consistency matters more than perfection — an OK pattern applied uniformly > a perfect pattern applied partially
- Errors are part of the API — invest in error responses as much as in success responses
- Versioning and a deprecation plan from day 1
- Pagination, filtering, and rate limiting are not optional in production APIs

## DO (Mandatory Practices)

### REST Conventions
- Plural resources: `/users`, `/orders`, `/products`
- Hierarchy by relationship: `/users/{id}/orders` (the user's orders)
- Correct HTTP verbs: GET (read), POST (create), PUT (replace), PATCH (partial update), DELETE (remove)
- Semantic status codes: 200 OK, 201 Created, 204 No Content, 400 Bad Request, 401 Unauthorized, 403 Forbidden, 404 Not Found, 409 Conflict, 422 Unprocessable Entity, 429 Too Many Requests, 500 Internal Server Error
- IDs in the URL, filters in the query string: `GET /users/123` vs `GET /users?role=admin&status=active`

### Versioning
- URL prefix: `/api/v1/users` — simple and explicit
- Keep v(N-1) functional for at least 6 months after releasing vN
- `Deprecation` and `Sunset` headers on deprecated endpoints
- Never break a contract in an existing version — always a new version

### Pagination
- Cursor-based for feeds/timelines (consistent with insertions): `?cursor=abc123&limit=20`
- Offset-based for tables/admin (simple, lets you "go to page X"): `?page=2&per_page=20`
- Response includes metadata: `{ data: [...], meta: { total, page, per_page, has_next } }`
- Default limit: 20, max limit: 100 — never return an entire collection without pagination

### Filtering & Sorting
- Filters as query params: `?status=active&created_after=2024-01-01`
- Explicit sorting: `?sort=created_at&order=desc`
- Text search: `?q=search+term` (full-text search on the backend)
- Return the applied filters in the response for transparency

### Error Response Format (standard)
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable description",
    "details": [
      { "field": "email", "message": "Invalid email", "code": "INVALID_FORMAT" }
    ],
    "request_id": "req_abc123"
  }
}
```

### Authentication
- Bearer token (JWT) for stateless APIs: `Authorization: Bearer <token>`
- API keys for server-to-server: via `X-API-Key` header, never in the URL
- OAuth 2.0 + PKCE for third-party access with granular scopes
- Refresh tokens with rotation: a new refresh token on each use, invalidate the previous one

### Rate Limiting
- Implement rate limiting per API key/user with informative headers
- Headers: `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- 429 Too Many Requests with a `Retry-After` header
- Different limits per tier/plan when applicable

### GraphQL (When to Use)
- Use it when: clients need flexible queries, multiple clients with different needs, complex relationship graph
- Do not use it when: simple API with well-defined resources, team without GraphQL experience, plain CRUD
- Always implement: depth limiting, complexity analysis, persisted queries
- N+1 is the biggest risk — use the DataLoader pattern without exception

## DON'T (Anti-Patterns)

- Verbs in the URL: `/getUsers`, `/createOrder` — use HTTP methods
- Returning 200 for errors with `{ success: false }` — use correct status codes
- Nested resources beyond 2 levels: `/users/1/orders/2/items/3/variants` — flatten
- Exposing internal DB IDs (auto-increment) — use UUIDs or public slugs
- Returning different data in the same endpoint based on user "type" — create separate endpoints
- Accepting a request body on GET — use query params or POST if needed
- Ignoring Content-Type: always validate and return `application/json` with a charset
- Pagination without a max limit — a client might request `?per_page=999999`
- Creating an `/api/do-everything` endpoint with a flag that changes behavior
- Exposing stack traces in production error responses

## Concrete Examples

### Endpoint Naming
```
DON'T: GET  /getActiveUsers
       POST /user/create
       POST /deleteUser/123

DO:    GET    /api/v1/users?status=active
       POST   /api/v1/users
       DELETE /api/v1/users/123
```

### Error Response
```
DON'T: { "status": 200, "success": false, "msg": "error" }
DO:    HTTP 422 Unprocessable Entity
       {
         "error": {
           "code": "VALIDATION_ERROR",
           "message": "Invalid data",
           "details": [{ "field": "email", "message": "Invalid format" }],
           "request_id": "req_x7k2m"
         }
       }
```

## Pre-Delivery Checklist
- [ ] Resources named in plural, URLs without verbs
- [ ] Correct HTTP status codes for every scenario (success and error)
- [ ] Error response follows the standard format with code, message, details
- [ ] Pagination implemented on every endpoint that returns a collection
- [ ] Rate limiting with informative headers
- [ ] Versioning in the URL (/api/v1/)
- [ ] Authentication documented (Bearer, API Key, or OAuth)
- [ ] No auto-increment IDs exposed — UUIDs in public URLs
- [ ] Content-Type validated and returned correctly
- [ ] Request IDs on every response for tracing
