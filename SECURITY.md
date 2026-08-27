# Security Policy

Security issues should be reported privately and should not be disclosed through a public GitHub issue.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting / Security Advisory workflow when available. If that mechanism is not enabled, contact the repository maintainers through a private channel rather than publishing exploit details.

A useful report includes:

- affected component and version or commit;
- reproduction steps;
- expected and observed behavior;
- security impact;
- whether exploitation requires authentication or a particular role/scope;
- any evidence of Tenant, Organization, Workspace or Project boundary impact;
- suggested remediation, if known.

Do not include real credentials, access tokens, production business data or unnecessary personal data in the report.

## Security-sensitive areas

Changes in the following areas require explicit security review:

- authentication and delegated identity;
- Connected App and capability authorization;
- Tenant / Organization / Workspace / Project containment;
- row-level security and SECURITY DEFINER database functions;
- service-role usage;
- encryption and protected narrative/data paths;
- API and MCP mutation controls;
- idempotency and optimistic concurrency;
- file/object storage permissions;
- CORS and deployment origin configuration;
- secrets and environment configuration;
- audit and provenance paths.

UI hiding is never a substitute for server-side authorization.

## Supported versions

Security support applies to the current released version of BTPM. Users should reproduce issues against the latest available release before reporting where practical. Older versions may be asked to upgrade before a fix is evaluated or backported.

## Disclosure

Please allow maintainers to investigate and prepare a correction before public disclosure. Once a fix is available, the project can coordinate an advisory that explains affected versions, impact and remediation without exposing unrelated confidential information.
