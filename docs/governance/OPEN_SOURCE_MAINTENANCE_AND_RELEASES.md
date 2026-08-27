# BTPM Open-Source Maintenance and Release Policy

## Purpose

This document describes how BTPM's public repository is maintained, how releases are prepared, and how contributions that affect product behavior are handled.

It is intentionally limited to public repository governance. Internal development infrastructure, private deployment details, and private release-traceability records are not part of this document.

## 1. Public repository role

`BTPM-Open-Source/BTPM` is the canonical public distribution of BTPM.

The public repository contains:

- released application source;
- public database migrations and bootstrap material;
- public API/MCP implementation and documentation;
- open-source installation and configuration guidance;
- public tests and engineering standards;
- contribution and security policies.

Public `main` is treated as a release-quality branch, not as a scratch or synchronization branch.

## 2. Release model

BTPM releases are prepared as coherent, reviewed increments.

A normal release is developed on a branch created from current public `main`, for example:

```text
release/v1.6.0
```

The branch must contain the complete intended public delta for that release, including product code, tests, migrations where applicable, and any configuration or documentation changes needed by operators.

The release branch is reviewed before merge. Public `main` is forward-only under normal operation; releases should not require history rewrites.

## 3. Versioning

BTPM uses semantic versioning.

General guidance:

- patch releases: backward-compatible fixes and small corrections;
- minor releases: meaningful backward-compatible feature increments;
- major releases: intentional breaking public contracts or major architecture changes.

Not every internal engineering change becomes an immediate public version. Public versions represent coherent released increments.

## 4. Database migration policy

Released public migrations are part of the external product contract.

Contributors and maintainers must:

- prefer forward-only migrations;
- avoid rewriting already-released migration history;
- preserve RLS, authorization, tenant containment, encryption and data-integrity guarantees;
- avoid hidden dependencies on deployment-specific data or identities;
- document compatibility and rollback implications.

A release that changes database behavior should validate both:

1. a fresh installation using the complete public migration set; and
2. an upgrade from the previous supported public release.

A correction to a released migration should normally be expressed as a later forward migration rather than rewriting public history.

## 5. Configuration documentation is part of the release

If a release introduces or materially changes configuration, the corresponding public documentation must be updated in the same release.

This includes changes to:

- environment variables;
- Supabase runtime or Edge Function secrets;
- authentication or SSO;
- OAuth / Connected Apps;
- REST API or MCP configuration;
- encryption or key lifecycle behavior;
- storage or file handling;
- scheduled jobs;
- external integrations;
- bootstrap requirements.

The public repository must remain sufficient for an operator to discover required configuration without relying on undocumented private knowledge.

Examples and templates must use placeholders rather than real credentials or production identifiers.

## 6. Publication safety

Every release must be reviewed for accidental disclosure before merge.

Do not commit:

- credentials, access tokens, API keys, client secrets, private keys, passwords or encryption material;
- real production environment files;
- production or private deployment identifiers unless intentionally documented as public;
- personal data or confidential business data;
- customer/project-specific test data;
- private logs, dumps, patches or temporary artifacts;
- local machine paths or developer-specific configuration.

Secret scanning and targeted publication-safety checks should complement normal code review.

## 7. Engineering and security requirements

The public repository follows the BTPM Engineering Standard.

Changes must preserve, where applicable:

- canonical source-of-truth discipline;
- explicit mutation boundaries;
- server-enforced Tenant / Organization / Workspace / Project containment;
- authentication and authorization guarantees;
- RLS and database privilege boundaries;
- encryption and protected read/write handling;
- optimistic concurrency behavior;
- bounded collection/query behavior;
- API/MCP parity with canonical business rules;
- persistence and data integrity.

A successful frontend build does not prove that a database, API, MCP, authorization, encryption or migration change is safe.

## 8. Validation expectations

Use validation appropriate to the changed surfaces.

Typical checks include:

```bash
npm ci
npm test
npm run build
npm run test:mcp
```

Additional focused checks may be required for database migrations, Edge Functions, authorization, API/MCP behavior, encryption, concurrency or integration changes.

Pull requests should state what was tested, what was not tested, and any remaining limitations.

## 9. Product-code contributions

Community contributions that change BTPM product behavior are welcome.

Maintainers may need to reconcile such changes with the canonical product development line before final public merge so that BTPM does not split into divergent product implementations.

This is a behavioral consistency requirement, not a requirement to expose or reproduce any private development history.

A public PR may therefore be:

- merged directly when it affects only public documentation, CI, templates or similar open-source infrastructure; or
- held briefly while the same product behavior is admitted and validated through the canonical BTPM product-development process.

Contributors should not need access to private infrastructure to build, test or understand the public product.

## 10. Pull-request expectations

A product PR should explain:

- the problem and intended behavior;
- files/components/contracts affected;
- database or migration impact;
- configuration/documentation impact;
- tests and validation performed;
- security and data-boundary impact;
- compatibility and rollback considerations;
- explicit non-goals and known unverified areas.

Keep unrelated refactoring out of focused feature or security changes whenever practical.

## 11. Security fixes

Do not disclose suspected vulnerabilities through a public issue when private reporting is available. Follow `SECURITY.md`.

Security fixes may be released outside the normal feature cadence, but they still require focused validation and review. Public commit messages and PR descriptions should not expose embargoed exploit details before coordinated disclosure is appropriate.

## 12. Failed release and rollback handling

Before merge, a failing release branch should be corrected or abandoned while leaving public `main` unchanged.

After merge, normal recovery is a reviewed forward fix/release rather than rewriting public history.

Once a release may have been cloned or deployed externally, assume its public commit and migration history are externally observable and preserve upgradeability from that state.

## 13. Maintainer principles

Maintainers should keep the public repository:

- understandable;
- buildable from public source;
- independently installable;
- upgradeable;
- documented;
- security-conscious;
- free from private deployment dependencies;
- forward-compatible with prior public releases wherever practical.

The goal is a clean public product history, not a verbatim mirror of internal implementation activity.
