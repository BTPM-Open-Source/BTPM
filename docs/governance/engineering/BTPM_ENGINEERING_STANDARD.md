# BTPM Engineering Standard

## Status and authority

This document is the canonical engineering standard for future BTPM development across frontend, backend, database, REST API, MCP, integrations, background jobs, tests, and repository delivery.

It supplements existing approved BTPM governance. Higher-authority approved governance decisions and later explicit governance corrections prevail where a conflict exists. If an implementation cannot satisfy both this standard and applicable BTPM governance, execution MUST stop for a governance or architecture decision rather than silently weakening either.

The engineering posture is progressive: stop new debt first, then remediate historical debt deliberately. Existing debt is not permission to create more debt.

## 1. Architecture

### A1 — Single source of business logic

Canonical business logic MUST NOT be duplicated across React/UI, REST API, MCP, integrations, scheduled jobs, or background jobs. Consumers SHOULD reuse the same governed business capabilities.

### A2 — PMG remains the canonical mutation boundary

Canonical PM-domain mutations MUST continue through the approved PMG/protected mutation boundary unless a later governance decision explicitly replaces that architecture.

### A3 — No generic mutation mechanism

BTPM MUST NOT introduce update-any-object, generic CRUD, arbitrary RPC execution, arbitrary table mutation, or equivalent generic mutation shortcuts as a substitute for explicit governed operations.

### A4 — Server-derived authority

Tenant, organization, workspace, project, object, and acting-user authority MUST be derived from or validated against trusted server state. Caller-supplied ownership, scope, role, or containment fields MUST NOT be treated as authoritative by themselves.

### A5 — Encryption and protected handling remain mandatory

New protected data surfaces MUST follow the established BTPM encrypted-at-rest and protected read/write handling model from inception. Plaintext search, reporting, cache, or shadow copies of protected data MUST NOT be introduced merely for convenience or performance.

### A6 — BTPM remains general-purpose

Team-specific schemas, modules, or business objects MUST NOT be added unless the capability is genuinely reusable across BTPM as a general-purpose PM platform.

## 2. TypeScript and boundary typing

### T1 — No new explicit `any`

New explicit `any` types MUST NOT be introduced.

### T2 — `as any` exceptions are narrow and documented

New `as any` casts MUST NOT be introduced except at a narrowly bounded technical boundary where no safe typed alternative exists. Any exception MUST be minimal and MUST document why the boundary cannot be typed safely.

### T3 — No new `@ts-ignore`; `@ts-expect-error` only as a documented narrow suppression

New `@ts-ignore` suppressions MUST NOT be introduced. A real type, parser, validator, or a more precise narrow suppression MUST be used instead where appropriate.

`@ts-expect-error` MAY be used only as a narrow, targeted suppression that carries an explicit documented technical reason in the same comment, using the marker `BTPM-ENG-TS-EXPECT-ERROR-EXCEPTION:` followed by a non-empty reason. An undocumented `@ts-expect-error` MUST NOT be introduced, and `@ts-expect-error` MUST NOT become a generic workaround for typing problems.

### T4 — Untrusted input starts as `unknown`

External or untrusted input MUST begin as `unknown` or an equivalent untrusted representation and MUST be validated or narrowed before becoming a domain type.

### T5 — Boundary validation is mandatory

Strong typing and validation are especially mandatory at these boundaries:

- HTTP to API parsing;
- MCP to API operation mapping;
- Supabase RPC to TypeScript;
- database result to projection;
- React hook to UI;
- external integration to BTPM.

### T6 — Prefer canonical/generated types

Generated schema types and canonical API/domain contracts SHOULD be reused instead of manually recreating the same shapes in multiple places.

### T7 — Progressive strictness

Repo-wide strict mode MUST NOT be enabled merely to satisfy this standard. BTPM SHOULD first stop new debt, then clean high-risk API/MCP/PMG/UI boundaries and historical debt, and only then increase compiler strictness deliberately.

## 3. Concurrency integrity

### C1 — Save against the originally loaded version

Every mutable shared-object editor or consumer MUST save against the version token, such as `updated_at`, that it originally loaded for the state being edited.

### C2 — Never refresh the version token merely to make a stale save succeed

A client MUST NOT fetch a fresh `updated_at` or version immediately before saving stale local state solely to satisfy optimistic concurrency.

### C3 — Server lock/read and compare

Where the canonical mutation contract uses optimistic concurrency, the server mutation MUST lock or otherwise safely read the current row as appropriate, compare it with the caller's expected base version, and reject stale updates.

### C4 — Conflicts fail closed

A stale update MUST write nothing. BTPM MUST NOT silently fall back to last-write-wins and MUST NOT automatically merge a stale full-form update.

### C5 — User-facing conflict handling

User-facing conflict handling MUST clearly communicate that the item changed, the attempted changes were not saved, and the latest state must be reviewed or reloaded before retrying.

### C6 — Consumer parity

UI, REST API, MCP, imports, integrations, background jobs, and other mutation consumers MUST NOT bypass the canonical concurrency model.

## 4. Collection and query scalability

### S1 — No new unbounded large collections

Potentially large business collections MUST NOT be loaded unbounded by default.

### S2 — Server-side collection operations

Potentially large collections SHOULD use server-side authorization, filtering, search, sorting, and bounded pagination or cursors as applicable.

### S3 — Server-enforced hard maximum

Large collection operations MUST enforce a server-side hard maximum response size.

### S4 — Avoid N+1 and fan-out patterns

BTPM SHOULD NOT fetch all containers and then issue one broad business-data query per container where a purpose-built authorized projection can satisfy the same reusable need.

### S5 — Preserve UX simplicity

Scalability work MUST NOT add unnecessary controls or complexity. Pagination, cursoring, virtualization, or server filtering SHOULD preserve the simplest practical user experience.

### S6 — AI/MCP responses are bounded too

AI and MCP collection responses MUST follow the same authorization, bounding, and continuation principles as other consumers.

## 5. Performance

### P1 — No speculative infrastructure

Microservices, Redis, Elasticsearch, sharding, distributed queues, or comparable infrastructure MUST NOT be introduced without measured need and an approved architecture change.

### P2 — Review important query plans

New high-volume or critical read queries SHOULD be reviewed with `EXPLAIN` or `EXPLAIN ANALYZE` where practical.

### P3 — Indexes are evidence-driven

Indexes SHOULD be added from demonstrated query patterns and plans rather than blindly.

### P4 — Performance never weakens protection

Performance work MUST NOT introduce unprotected plaintext copies of protected data.

### P5 — Normal controls apply to API and MCP

API and MCP consumers remain subject to normal authorization, paging, rate, and bounded-response controls.

## 6. Testing and verification

### Q1 — Permanent tests protect behavior and invariants

Permanent tests SHOULD protect business behavior and important invariants, including authorization, tenant isolation, encryption, concurrency, API/MCP contracts, PMG invariants, critical calculations, and idempotency or rate controls where applicable.

### Q2 — Delivery-stage static guards may be temporary

Phase-specific static guards MAY be temporary implementation controls and MUST NOT automatically become permanent architecture.

### Q3 — Replace important coverage before removing a guard

A historical guard MUST NOT be removed until its important invariant is protected by an appropriate permanent regression or contract test.

### Q4 — Prefer behavioral assertions

Tests SHOULD assert outcomes and contracts rather than implementation strings, unless the exact implementation structure is itself a security or governance invariant.

### Q5 — Implementation-agent reports are supporting evidence only

Implementation-agent reports and implementation-agent test results are supporting evidence. Independent repository review and the currently approved BTPM execution-control requirements remain mandatory. Retired GitHub status workflows are not mandatory unless later governance explicitly reinstates them.

## 7. Repository and delivery

### R1 — Converge on one package-manager model deliberately

BTPM SHOULD move toward one authoritative package-manager and lockfile model, but unrelated delivery steps MUST NOT change historical package-manager state merely for cleanup.

### R2 — Meaningful commit messages

Commits MUST use meaningful step- or domain-oriented messages. Generic messages such as `Changes` MUST NOT be used for governed delivery.

### R3 — Retire obsolete scaffolding deliberately

PoC or test scaffolding SHOULD be removed when obsolete unless intentionally retained and documented. Speculative cleanup MUST NOT be mixed into unrelated feature work.

### R4 — Production comments describe current behavior

Production comments SHOULD primarily explain current behavior. Historical delivery identifiers MAY remain where they are still operationally useful.

### R5 — Keep implementation steps bounded

Each implementation step MUST be narrowly bounded, MUST state explicit non-goals, and MUST preserve unchanged behavior outside its approved scope.

## 8. Engineering impact reporting

Every future implementation report MUST explicitly state the impact, including `none` when genuinely none, for:

- types and boundary validation;
- permissions and tenant/organization/workspace containment;
- encryption and protected handling;
- concurrency;
- collection/query scalability and performance;
- persistence, schema, and runtime actions;
- scope drift and intentional non-work.

## 9. Change control

This standard MAY be weakened or materially changed only through an explicit governance change. Convenience, token cost, delivery pressure, implementation difficulty, or a passing test is not a valid reason to bypass it.
