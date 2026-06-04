# CI/CD & Monitoring

> Scope: When the task involves build/deploy pipelines, deployment strategies, observability, alerting, or rollback.

## Core Principles
- A reliable pipeline > a fast pipeline. Flaky tests and inconsistent deploys destroy trust
- A deploy should be a routine event, not a ceremony — automate until it is boring
- Observability is about answering "why is the system behaving this way?" — not about pretty dashboards
- Alerts must be actionable — if it does not require immediate human action, it is not an alert
- A quick rollback matters more than a perfect deploy — always have an escape route

## DO (Mandatory Practices)

### Pipeline Stages
1. **Lint:** style and static-error checks (ESLint, Prettier, Clippy, golangci-lint)
2. **Test:** unit tests + integration tests. Failure here = do not continue
3. **Build:** immutable artifact (Docker image, binary). Tagged with the commit SHA
4. **Security Scan:** dependency audit (npm audit, Snyk), basic SAST, secret scanning
5. **Deploy Staging:** automatic deploy to staging with smoke tests
6. **Deploy Prod:** automatic deploy (if staging passed) or manual trigger

### Pipeline Best Practices
- Cache dependencies between runs (node_modules, .m2, pip cache)
- Parallelize independent stages (lint and test in parallel)
- Fail fast: lint and type-check before tests (faster, catch obvious errors)
- Immutable artifact: the same image/binary that passed in staging goes to prod
- Target time: < 10min for the PR pipeline, < 20min for a full deploy

### Deployment Strategies
- **Rolling:** pods updated gradually. Simple. Watch out for incompatible schema changes
- **Blue-Green:** two identical environments. Instant traffic switch. Rollback = switch back
- **Canary:** new version to % of traffic (1% → 5% → 25% → 100%). Monitor metrics between each step
- **Feature Flags:** deploy code off, turn it on gradually per segment. Decouples deploy from release

### Choosing a Strategy
- Simple CRUD, small team → Rolling with health checks
- Requires instant rollback → Blue-Green
- Critical feature with risk → Canary + automatic monitoring
- Gradual rollout per segment → Feature Flags

### Observability: Logs
- Structured format (JSON) with standard fields: timestamp, level, message, service, requestId
- Centralize on a single platform: ELK, Loki+Grafana, Datadog, CloudWatch
- Retention: 30 days hot (searchable), 90 days cold (archive), 1 year compliance (if needed)
- Correlation: requestId crosses every service in the chain (distributed tracing)

### Observability: Metrics
- **RED Method (request-driven):** Rate, Errors, Duration — per endpoint
- **USE Method (resource-driven):** Utilization, Saturation, Errors — for infrastructure
- Business metrics: signups/h, orders/h, revenue — what matters for the product
- Dashboards: 1 overview (overall health), 1 per service (details), 1 business

### Observability: Traces
- Distributed tracing for architectures with 2+ services
- Trace ID propagated via header (W3C Trace Context: `traceparent`)
- Sample rate: 100% in dev/staging, 1-10% in prod (adjust by volume)
- Trace slow endpoints (> p95) and errors (100%)

### Alerting
- **Critical (page):** system unavailable, data loss risk, security breach. Action: immediate
- **Warning (ticket):** performance degradation, disk > 80%, error rate above normal. Action: next business day
- **Info (dashboard):** deploy completed, scaling event, cache miss rate up. Action: none
- An alert must contain: WHAT broke, IMPACT on the user, LINK to the runbook
- Define SLOs (99.9% uptime = 43min downtime/month) and alert BEFORE violating them

### Alerting Anti-Noise
- Do not alert on a single threshold — use sustained over window (e.g. error rate > 5% for 5min)
- Group related alerts — 1 alert for "service X degraded", not 50 alerts per endpoint
- Review alerts monthly: if no one acted, remove it or downgrade to warning
- On-call rotation with escalation: primary → secondary → manager

### Rollback
- **Automated:** health metrics degrade after a deploy → automatic rollback in 2min
- **Manual:** always available with 1 command/click — no more than 5min to execute
- **Database:** forward-only migrations with backward compatibility. Never destructive schema rollbacks
- **Feature Flags:** rollback = turn the flag off. Instant, no deploy
- Test rollback regularly — do not discover it does not work during an incident

## DON'T (Anti-Patterns)

- **Friday deploy**: avoid deploys on Friday or before holidays. If it goes wrong, who responds?
- **Ignored flaky tests**: a test that fails "sometimes" marked as skip. Fix it or remove it
- **Alert fatigue**: 200 alerts/day where 195 are false positives. The team ignores them all, including the real ones
- **Orphan dashboards**: 30 dashboards nobody looks at. Fewer dashboards, more actionable
- **Logs as debugging**: `console.log("here 1")` in production. Use structured logging
- **Manual deploy via SSH**: "run this script on the server". Pipeline or nothing
- **No rollback plan**: "we never needed one". Until you do and do not have one
- **Branch deploy**: branches go to different environments. Use: main → staging → prod with a single artifact
- **Secrets in the pipeline YAML**: use the CI provider's secret store (GitHub Secrets, Vault)
- **45-minute pipeline**: parallelize, cache, or split. Developer experience matters

## Concrete Examples

### Pipeline Config
```yaml
# DON'T: all sequential, no cache, no fail-fast
# DO: parallel where possible, aggressive caching
stages:
  - name: checks  # parallel
    jobs:
      - lint
      - typecheck
      - security-scan
  - name: test    # after checks
    jobs:
      - unit-tests
      - integration-tests
  - name: build   # after tests
    jobs:
      - docker-build  # tag with commit SHA
  - name: deploy-staging
    trigger: auto on main
  - name: deploy-prod
    trigger: manual (or auto if staging passes + canary)
```

### Alert Definition
```
DON'T: Alert "CPU > 80%" (so what? auto-scaling handles it)
DO:    Alert "Error rate > 5% sustained for 5min"
       Severity: Critical
       Impact: ~5% of users getting a 500 error
       Runbook: https://wiki/runbooks/high-error-rate
       Action: Check recent deploys, check dependency health
```

## Pre-Delivery Checklist
- [ ] Pipeline with stages: lint → test → build → deploy
- [ ] Immutable artifact (same image staging → prod)
- [ ] Rollback executable in < 5 minutes
- [ ] Structured logs with requestId for correlation
- [ ] RED metrics (Rate, Errors, Duration) on critical endpoints
- [ ] Alerts with defined severity and a linked runbook
- [ ] Alerts tested (trigger one to verify routing)
- [ ] Secrets in the secret store (not in the pipeline YAML or repo)
- [ ] Automatic staging deploy, prod with a gate (manual or canary)
- [ ] Full pipeline in < 15 minutes
