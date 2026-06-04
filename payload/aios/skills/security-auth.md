# Security & Authentication

> Scope: When the task involves authentication, authorization, attack protection, or handling sensitive data.

## Core Principles
- Security is layered (defense in depth) — no single layer is sufficient
- Never implement your own crypto — use audited libraries and established standards
- Principle of least privilege: grant only the minimum permissions needed
- Assume external input is malicious. Assume the attacker knows your code
- Fail securely: when in doubt, deny access

## DO (Mandatory Practices)

### OWASP Top 10 Essentials
- **Injection (SQL, NoSQL, OS):** Parameterized queries ALWAYS. Never concatenate input into queries
- **XSS (Cross-Site Scripting):** Escape output per context (HTML, JS, URL, CSS). Use a CSP header
- **CSRF:** CSRF token on stateful forms OR SameSite=Strict cookies + verify the Origin header
- **Broken Access Control:** Check authorization on EVERY endpoint — never rely on the client hiding buttons
- **Security Misconfiguration:** Security headers, disable directory listing, remove defaults
- **Sensitive Data Exposure:** Mandatory HTTPS, encrypt data at rest, never log PII

### Authentication Flows
- **JWT (stateless):** Short access token (15min) + long refresh token (7-30 days) with rotation
- **Sessions (stateful):** Opaque session ID in HttpOnly + Secure + SameSite=Lax cookie
- **OAuth 2.0 + PKCE:** For third-party login. PKCE mandatory (removes the need for a client secret in the frontend)
- **Passkeys/WebAuthn:** Prefer for new implementations — phishing-resistant by design
- **MFA:** TOTP (authenticator app) as a minimum. WebAuthn as the ideal. SMS as a last resort

### Password Handling
- Hash with Argon2id (preferred) or bcrypt (minimum cost 12)
- NEVER: MD5, SHA-256, SHA-512 for passwords (too fast = easy brute-force)
- Enforce minimum 8 characters, recommend 12+, no maximum limit below 128
- Check against leaked-password lists (HaveIBeenPwned API, top 10k list)
- Never reveal whether an email exists in the system in "forgot password" — same response for existing and non-existing email

### Security Headers
```
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

### CORS
- Never `Access-Control-Allow-Origin: *` with credentials
- Explicit whitelist of allowed origins
- Limit methods and headers to what is needed
- Preflight caching: `Access-Control-Max-Age: 7200`

### Rate Limiting for Auth
- Login: max 5 attempts per IP/email in 15 minutes → temporary lockout
- Forgot password: max 3 requests per email in 1 hour
- API auth: max 100 requests per minute per API key
- Use progressive delays: 1s, 2s, 4s, 8s between attempts

### Tokens & Secrets
- JWTs: minimal payload (sub, exp, iat, roles). Never include PII in the payload
- Signing: RS256 (asymmetric) for multi-service, HS256 for a single service
- Refresh token: opaque, stored in the DB with a hash, rotated on each use
- API keys: identifiable prefix (`sk_live_`, `pk_test_`), hashed in the DB, revocable
- Secrets: never in code, never in logs, always via env vars or a secret manager

## DON'T (Anti-Patterns)

- **JWT in localStorage**: vulnerable to XSS. Use an HttpOnly cookie
- **Password in plain text**: anywhere — DB, logs, emails
- **Homemade crypto**: never implement hashing, encryption, or token generation yourself
- **Security by obscurity**: hiding endpoints is not protection. Authenticate and authorize
- **Wildcard CORS**: `*` with cookies = any site can make authenticated requests
- **Secret in query string**: URLs are logged in servers, proxies, browser history
- **Validate only on the client**: every client-side validation is bypassable. Validate on the server
- **Permissions on the client**: hiding a button is not authorization. Check on the backend
- **Token without expiration**: every token MUST expire. Refresh flow for renewal
- **Same-response timing**: login with a non-existent email returns faster than an existing email = oracle. Equalize response time

## Concrete Examples

### Secure JWT Flow
```
1. POST /auth/login { email, password }
   → Verifies the password hash (Argon2id)
   → Generates access_token (JWT, 15min) + refresh_token (opaque, 30 days)
   → Set-Cookie: refresh_token=...; HttpOnly; Secure; SameSite=Lax; Path=/auth
   → Response: { access_token: "eyJ..." }

2. GET /api/users (with Authorization: Bearer <access_token>)
   → Validates JWT signature + exp

3. POST /auth/refresh (Cookie: refresh_token=...)
   → Validates the refresh token in the DB
   → Rotates: new refresh token, invalidates the previous one
   → Returns a new access_token
```

### Input Sanitization
```
DON'T: db.query(`SELECT * FROM users WHERE name = '${req.body.name}'`)
DO:    db.query('SELECT * FROM users WHERE name = $1', [req.body.name])
```

### Password Reset
```
DON'T: "Email not found" vs "Email sent" (reveals existence)
DO:    Always return "If this email is registered, you will receive instructions"
       Token: random 32+ bytes, hashed in the DB, expires in 1h, single use
```

## Pre-Delivery Checklist
- [ ] Every query uses parameterized statements (zero string concat)
- [ ] Passwords hashed with Argon2id or bcrypt (cost >= 12)
- [ ] HTTPS enforced (HSTS header present)
- [ ] Security headers configured (CSP, X-Content-Type-Options, etc.)
- [ ] Explicit CORS whitelist (no wildcard with credentials)
- [ ] Rate limiting on auth endpoints
- [ ] Tokens with a defined expiration
- [ ] Zero secrets in code or logs
- [ ] Authorization verified on the backend (not only client-side)
- [ ] Input validated and sanitized on the server for every input
