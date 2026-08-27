# Optional integrations

BTPM can be used without configuring external provider integrations. Configure only the integrations your Tenant needs, after the first Tenant/Organization/Workspace bootstrap is complete.

Provider credentials belong in BTPM's protected Tenant integration-secret system, not in browser `VITE_*` variables or source files.

## Where to configure integrations

Use **Tenant Admin → Integrations**. The setup flow stores logical provider secrets through protected backend operations and does not expose stored secret values afterward.

The current UI secret catalog supports these integration kinds:

- OpenAI;
- Azure OpenAI;
- Microsoft Graph;
- SharePoint;
- MuleSoft KPI;
- SMTP.

Other product areas may contain integration architecture or placeholders, but do not invent credentials for a provider unless the current Tenant Admin catalog/runtime explicitly supports them.

## Secret scope

Catalogued integration secrets support Tenant-level storage and, where allowed by the backend, Organization override. Use Tenant values for shared configuration and Organization overrides only when an Organization genuinely requires different credentials/configuration.

Keep development/test and production credentials separate.

## OpenAI

Required protected secret:

| Logical name | Meaning |
| --- | --- |
| `api_key` | OpenAI API key |

The API key is stored here. AI model selection is handled separately through BTPM AI Settings; do not encode model choice into the secret value.

## Azure OpenAI

Required protected secret:

| Logical name | Meaning |
| --- | --- |
| `api_key` | Azure OpenAI resource key |

The current secret catalog intentionally stores only the API key. The Azure resource endpoint is non-secret configuration handled by the Azure OpenAI configuration surface. Do not put the endpoint and key together into one secret string.

## Microsoft Graph

Required protected secrets:

| Logical name | Meaning |
| --- | --- |
| `tenant_id` | Microsoft Entra tenant ID used by the Graph application |
| `client_id` | Microsoft application/client ID |
| `client_secret` | Microsoft application client secret |

These credentials are for Microsoft Graph API calls and are **not** the same as end-user Microsoft sign-in configuration.

Create an application registration with only the Graph permissions required by the BTPM features you intend to use. Apply your organization's admin-consent process where required. Keep the client secret server-side and rotate it before expiry.

## SharePoint

SharePoint publishing reuses the Microsoft Graph credentials and stores site coordinates separately.

| Logical name | Required | Meaning |
| --- | --- | --- |
| `site_url` | Yes | SharePoint site URL |
| `site_id` | No | Optional Microsoft Graph site identifier |

Configure Microsoft Graph first. Use the exact intended site and restrict the external application to the least privileges practical for the publishing operations you enable.

## MuleSoft KPI

Required protected secrets:

| Logical name | Meaning |
| --- | --- |
| `api_url` | MuleSoft KPI endpoint |
| `username` | Endpoint username |
| `password` | Endpoint password |

Use a dedicated integration identity rather than a personal account where your MuleSoft security model supports it. Restrict the endpoint to the BTPM KPI operation actually required.

## SMTP

SMTP is the protected outbound-email transport. The runtime is designed to block SMTP use in non-production environments.

| Logical name | Required | Meaning |
| --- | --- | --- |
| `host` | Yes | SMTP server hostname |
| `port` | Yes | SMTP server port |
| `username` | No | SMTP username |
| `password` | Yes | SMTP password/credential |
| `from_email` | Yes | Sender address |
| `from_name` | No | Sender display name |

Use a dedicated sending identity and configure SPF/DKIM/DMARC or equivalent mail-domain controls according to your mail provider and organization policy.

Password-reset and notification delivery involve server-side functions. Test mail delivery in an appropriate environment before relying on it operationally.

## Integration secret handling

The secret catalog stores **logical names**, not embedded credential values. Runtime code resolves those logical secrets through BTPM's protected Tenant integration configuration.

Do not:

- place provider keys in `.env.example`;
- put client secrets in `VITE_*`;
- store a secret in a project description, comment or generated document;
- expose secret fingerprints/Vault identifiers as substitutes for authorization;
- bypass the protected integration UI by writing directly to database secret tables;
- reuse production credentials in public demos or test projects.

## Microsoft SSO versus Microsoft Graph

These are separate configurations:

**Microsoft user sign-in**
: Supabase Auth `azure` provider + Microsoft application/provider configuration. Used to authenticate a human BTPM user.

**Microsoft Graph integration**
: Tenant Admin protected `tenant_id`, `client_id`, `client_secret`. Used by BTPM server-side integrations.

A working Microsoft login does not imply Graph/SharePoint is configured, and Graph application credentials should not be used as browser-login secrets unless your Supabase identity design explicitly and securely uses the same registration.

## SAP, Salesforce, webhooks and other external systems

BTPM's architecture can integrate with external systems through its REST API, MCP and dedicated integration surfaces. However, this repository's current Tenant Admin secret catalog is the authoritative list for the protected provider-secret setup described above.

For SAP, Salesforce, generic webhooks, storage/export targets or other systems not represented by the current catalog, use the supported BTPM API/Connected App architecture or the specific implemented integration contract. Do not invent a database secret name or direct database credential path.

See [OAUTH_AND_CONNECTED_APPS.md](./OAUTH_AND_CONNECTED_APPS.md) for external REST/MCP clients.

## Operational validation

For every enabled integration:

1. configure credentials in a non-production environment first where the runtime permits it;
2. verify the intended Tenant/Organization scope;
3. test the narrowest harmless operation;
4. inspect failure behavior for secret leakage;
5. verify credentials are absent from browser bundles and Git history;
6. record credential ownership and expiry/rotation responsibility;
7. repeat validation after moving to production credentials.

If a provider configuration is not described by the current executable source or these repository documents, inspect the runtime before assuming how it should be configured.
