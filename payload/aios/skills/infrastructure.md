# Infrastructure

> Scope: When the task involves containers, cloud deployment, networking, scaling, or environment configuration.

## Core Principles
- Infrastructure is code (IaC) — reproducible, versioned, reviewable
- Environments should be identical except for config — dev, staging, and prod run the same artifact
- Immutability: do not modify production servers — replace them
- Automate anything that will be done more than twice
- Costs must be monitored with the same seriousness as performance

## DO (Mandatory Practices)

### Containers (Docker)
- Multi-stage builds: separate build stage from runtime (the final image only has the artifact)
- Minimal base image: `alpine`, `slim`, or `distroless`. Never the `latest` tag — pin the version
- One process per container — do not run app + DB + cache in the same container
- `.dockerignore` covering: node_modules, .git, .env, tests, docs
- Non-root user: `USER node` / `USER appuser` — never run as root
- Defined health check: `HEALTHCHECK CMD curl -f http://localhost:3000/health`
- Layer ordering: dependencies first (change less), code later (changes always)

```dockerfile
# Multi-stage example
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s CMD wget -q --spider http://localhost:3000/health
CMD ["node", "dist/main.js"]
```

### Cloud Patterns
- **Auto-scaling:** define based on real metrics (CPU, request count, queue depth), not intuition
- **Load Balancer:** active health checks, connection draining for graceful deploys
- **Stateless services:** zero in-memory state between requests — use Redis/DB for shared state
- **Managed services when possible:** DB, cache, queue, object storage — do not manage infrastructure the cloud does better

### Networking
- **DNS:** low TTL (300s) during migrations, high TTL (3600s) in steady state
- **CDN:** static assets, images, fonts always via CDN. Correct cache headers
- **Reverse Proxy:** Nginx/Caddy at the front — TLS termination, rate limiting, static files, compression
- **HTTPS everywhere:** TLS 1.2+ minimum, auto-renewing certificates (Let's Encrypt / ACM)
- **Firewall/Security Groups:** principle of least privilege. Only required ports open. DB never publicly exposed

### Environment Separation
- **dev:** local or container, synthetic data, hot-reload, debug enabled
- **staging:** prod replica (same infra, smaller scale), anonymized prod data
- **prod:** auto-scaling, monitoring, alerting, backups, zero debug endpoints
- Same Docker image in every environment — only config changes (env vars)
- Feature flags for gradual rollout, not deploy branches

### Secrets Management
- Never in a hard-coded environment variable or committed file
- Use a secret manager: AWS Secrets Manager, Vault, GCP Secret Manager, Doppler
- Automatic secret rotation when possible
- Principle of least privilege: each service only accesses its own secrets

### Cost Optimization
- Right-size instances: monitor real CPU/memory use before scaling vertically
- Spot/preemptible instances for interruption-tolerant workloads (batch, CI)
- Auto-scaling with scale-to-zero for dev/staging environments
- Object storage lifecycle: move old data to cold storage automatically
- Monitor spending daily — configure billing alerts

## DON'T (Anti-Patterns)

- **Snowflake servers:** manually configured servers that "no one knows how to replicate". IaC or nothing
- **SSH to deploy:** if you need SSH in prod, your pipeline needs work
- **Latest tag in prod:** `FROM node:latest` can change tomorrow and break your build. Pin versions
- **Root in containers:** compromise the container = compromise the host. Always non-root
- **Secrets in a Docker image:** ARG/ENV with secrets stay in layers. Use runtime injection
- **Single point of failure:** single load balancer, single DB without replica. Always redundancy for critical components
- **Local logging to disk:** loses logs when the container dies. Use stdout → centralized logging
- **Ignoring backups:** an untested backup is not a backup. Test restore regularly
- **Over-provisioning:** 8 vCPU at 5% use. Right-size based on data

## Concrete Examples

### Compose for Dev
```yaml
# DON'T: 15 services with prod configuration in docker-compose.dev.yml
# DO: the minimum needed to develop
services:
  app:
    build: .
    ports: ["3000:3000"]
    volumes: ["./src:/app/src"]  # hot reload
    env_file: .env
    depends_on: [db, redis]
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: app_dev
      POSTGRES_PASSWORD: localdev
    ports: ["5432:5432"]
    volumes: [pgdata:/var/lib/postgresql/data]
  redis:
    image: redis:7-alpine
    ports: ["6379:6379"]
volumes:
  pgdata:
```

### Security Groups
```
DON'T: Inbound: 0.0.0.0/0 → all ports  (everything open)
DO:    Web:   0.0.0.0/0 → 443 (HTTPS only)
       App:   LB-SG     → 3000
       DB:    App-SG    → 5432 (only app servers)
```

## Pre-Delivery Checklist
- [ ] Docker multi-stage build with a minimal final image
- [ ] Container runs as a non-root user
- [ ] Health check defined in the container
- [ ] Zero secrets in the Docker image or in hard-coded env vars
- [ ] Environments (dev/staging/prod) use the same image, different config
- [ ] HTTPS enforced with TLS 1.2+
- [ ] Database not publicly exposed (only the app security group)
- [ ] Backups configured and restore tested
- [ ] Auto-scaling configured with real metrics
- [ ] Billing alerts configured
