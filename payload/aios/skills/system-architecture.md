# System Architecture

> Scope: When the task involves architectural decisions, system structuring, pattern choice, or defining boundaries between modules/services.

## Core Principles
- Start with a monolith. Extract services only when the pain justifies the complexity
- Clear boundaries > fancy technology. Separation of concerns is the most important decision
- Fast reversible decisions > slow optimal decisions
- Accidental complexity is the biggest enemy — every added layer must solve a real problem
- Optimize for change, not for premature performance

## DO (Mandatory Practices)

### Decision Framework: Monolith vs Microservices
- **Use a Monolith when:** team < 10 devs, domain not yet stable, MVP/v1, a single deploy is enough
- **Consider Microservices when:** independent teams need independent deploys, parts of the system scale differently, well-defined domain with clear boundaries
- **Modular Monolith is the middle ground:** module boundaries as if they were services, but a single deploy. The best of both worlds for 80% of cases

### Patterns by Context
- **Clean Architecture / Hexagonal:** when the domain is complex and needs to be testable in isolation. Core does not depend on frameworks
- **CQRS:** when reads and writes have very different models or scale differently. DO NOT use by default
- **Event Sourcing:** when a complete audit trail is required (financial, compliance). High complexity — justify
- **Event-Driven:** when temporal decoupling is needed (async processes, notifications, integration between systems)
- **Layered (Controllers → Services → Repositories):** sufficient for 70% of CRUD applications. Do not underestimate simplicity

### Boundaries and Modularization
- Define boundaries by business domain, not by technical type (not: controllers/, services/, models/ | yes: orders/, users/, billing/)
- Each module exposes a public interface (API/contract), hides its implementation
- Dependencies between modules: unidirectional and explicit (never circular)
- Minimal shared kernel: only shared types/interfaces, never logic

### Scalability
- Horizontal scaling: stateless services + load balancer + external shared state (Redis, DB)
- Layered caching: browser → CDN → reverse proxy → application → database
- Read replicas for heavy queries — separate read/write in the DB if needed
- Queue/worker for long-running processes — never block the request/response cycle

## DON'T (Anti-Patterns)

- **Premature microservices:** do not extract a service before understanding the domain. Refactoring a monolith is easier than refactoring a distributed system
- **Distributed Monolith:** microservices that deploy together, share a database, and break in cascade. Worst of both worlds
- **Golden Hammer:** using pattern X for everything because it worked once (e.g. Event Sourcing for a simple CRUD)
- **Abstraction Astronaut:** creating 5 layers of abstractions "for the future". YAGNI — implement when needed
- **Shared Database between services:** couples services by storage — each service owns its data
- **Circular dependencies:** module A depends on B, which depends on A. Refactor: extract an interface or merge
- **Lasagna Architecture:** so many layers that a simple change requires editing 8 files
- **Big Ball of Mud:** no boundaries, everything imports everything. Start with at least domain-level separation

## Concrete Examples

### Project Structure
```
DON'T: src/
         controllers/
         services/
         models/
         repositories/    (organized by technical type — does not scale)

DO:   src/
        modules/
          orders/
            order.controller.ts
            order.service.ts
            order.repository.ts
            order.types.ts
          users/
            user.controller.ts
            user.service.ts
          shared/
            types.ts         (only shared interfaces)
```

### Decision Record
```
DON'T: "Let's use microservices because it's modern"
DO:    "ADR-003: Keep modular monolith. Reason: team of 4, domain still being explored,
        single deploy is sufficient. Revisit when: team > 8 or need for
        scaling of a specific module independently."
```

### When to Add a Pattern
```
DON'T: CQRS + Event Sourcing + Saga for a TODO list app
DO:    Layered architecture for v1. CQRS when reads need a model
       different from writes. Event Sourcing only if audit trail is a legal requirement.
```

## Pre-Delivery Checklist
- [ ] Documented justification for the chosen architectural pattern
- [ ] Boundaries defined by domain (not by technical type)
- [ ] Zero circular dependencies between modules
- [ ] Pattern complexity proportional to problem complexity
- [ ] Long-running processes are async (queue/worker), do not block the request
- [ ] Session state is external (not in-memory) to allow horizontal scaling
- [ ] Decision Records (ADRs) for significant architectural choices
- [ ] High-level diagram with boundaries and data flow
