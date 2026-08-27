# Contributing to BTPM

Thank you for helping improve BTPM. Contributions should preserve the product's execution-focused scope, canonical source-of-truth model and security boundaries.

Before contributing product code, also read [Open-Source Maintenance and Release Policy](./docs/governance/OPEN_SOURCE_MAINTENANCE_AND_RELEASES.md) for the public release, migration, versioning and maintainer workflow.

## Before changing code

1. Read the relevant implementation and tests before proposing a change.
2. Keep each change focused on one coherent objective.
3. Do not duplicate source data or introduce downstream state that can be derived from canonical records.
4. Treat Tenant, Organization, Workspace and Project containment as server-enforced security boundaries.
5. Do not weaken authentication, authorization, RLS, encryption, idempotency, optimistic concurrency or audit/provenance controls to simplify a feature.
6. Do not commit credentials, access tokens, private keys, production identifiers, personal data or confidential business data.

## Local validation

Use the validation commands relevant to the files you changed. The principal repository commands are:

```bash
npm run lint
npm test
npm run build
npm run test:mcp
```

Some Edge/API/MCP tests run under Deno and have additional focused commands documented alongside their test infrastructure.

A contribution is not considered safe merely because the frontend builds. Changes to database, Edge Function, API, MCP, authorization, tenant containment or encryption surfaces require targeted review of the complete data and control path.

The initial open-source baseline includes inherited repository-wide lint findings. Contributors should not be expected to eliminate unrelated historical lint debt in a focused change, but they should avoid introducing new findings and should resolve lint issues in code they materially modify where practical.

## Database and migration changes

Database changes require particular care:

- prefer forward-only migrations;
- do not rewrite already-released migration history casually;
- preserve RLS and containment guarantees;
- keep protected business data on the approved encrypted read/write paths;
- avoid destructive or unbounded data operations;
- document rollback and compatibility implications.

## API and MCP changes

The REST and MCP documentation is explanatory; executable source is authoritative.

When changing an external contract, update the relevant implementation, tests and `docs/integrations/` documentation together. Preserve delegated-user authority and canonical BTPM business rules across both surfaces.

## Pull requests

A pull request should explain:

- the problem and intended behavior;
- the files and protected surfaces affected;
- tests and validation performed;
- security, data and migration impact;
- intentional non-goals;
- any known unverified behavior or follow-up work.

Keep unrelated refactoring out of feature or security fixes whenever practical.

## Security reports

Do not disclose suspected vulnerabilities in a public issue. Follow [SECURITY.md](./SECURITY.md).

## License

By contributing to BTPM, you agree that your contribution may be distributed under the repository's [MIT License](./LICENSE).
