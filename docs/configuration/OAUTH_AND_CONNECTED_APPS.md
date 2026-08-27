# OAuth and Connected Apps

BTPM Connected Apps are the administration layer for external applications and AI/MCP clients that need governed access to BTPM REST API v1 or BTPM MCP.

They are not the same thing as end-user Microsoft sign-in. User authentication is handled by Supabase Auth; Connected Apps govern an external client that acts with a delegated BTPM user token and an approved client identity.

## When you need a Connected App

You need a Connected App when an external system, automation, Copilot or MCP client must call BTPM through the supported REST/MCP surfaces.

You do not need a Connected App simply to use the BTPM browser UI.

## Administration model

Connected App registration is Platform-level administration. Use the Platform Admin client-management UI to create and maintain a registered API client.

The client administration model includes:

- client display/registration metadata;
- lifecycle state;
- OAuth client ID binding;
- approved OAuth redirect URIs;
- policy and consent versions;
- supported BTPM capabilities;
- MCP protected-resource configuration where applicable;
- connection/activity evidence.

Do not grant capabilities at a broader scope merely to solve a client configuration error.

## OAuth client ID

Bind the OAuth client ID that represents the external application in the Supabase/OAuth authorization flow. The value identifies the application; it is not a browser-stored client secret.

BTPM's external API architecture uses Supabase-issued access tokens and validates the signed client identity, current user/session and BTPM Connected App authorization before protected API work proceeds.

## Redirect URIs

Register only the exact callback URLs required by the external application. Use HTTPS for production callbacks.

Avoid:

- wildcard redirects;
- obsolete development callbacks in production;
- callbacks controlled by a different application;
- query-string tricks intended to turn one redirect into many.

The redirect registry is part of the governed Connected App lifecycle and should be changed through Platform Administration rather than direct database editing.

## Policy and consent

Connected Apps support policy/consent governance. Keep the active policy current and ensure the delegated user has satisfied the required acknowledgement before relying on production access.

Do not bypass policy checks by issuing or reusing a token outside the supported flow.

## Capabilities

BTPM does not treat an OAuth token as blanket permission to the product. External access is additionally constrained by the registered client's supported capabilities and the delegated user's normal BTPM authority.

Grant only the capabilities the external application requires. Tenant, Organization, Workspace and Project containment remains authoritative even when a client has the corresponding API capability.

See:

- [REST API v1](../integrations/REST_API.md)
- [BTPM MCP](../integrations/MCP.md)
- [REST / MCP capability matrix](../integrations/CAPABILITY_MATRIX.md)
- [Integration security and administration](../integrations/SECURITY_AND_ADMINISTRATION.md)

## MCP protected resource

For a client that will connect to BTPM MCP, configure its protected resource as **BTPM MCP** in Platform Administration.

The accepted administrative values are bounded to:

```text
none
btpm_mcp
```

The browser submits only the client ID and this bounded selection. It does not submit an audience URL.

The server resolves the canonical audience from:

```text
BTPM_MCP_RESOURCE_URI
```

This server-controlled value is also the canonical MCP protected-resource identifier. Configure it before enabling MCP clients.

The URI must be HTTPS and must not contain embedded credentials, query parameters or fragments.

## Active-client changes

Changing the protected-resource configuration of an active client is a security-relevant operation. The UI requires confirmation. Existing access tokens are not retroactively rewritten; configuration applies to newly issued tokens and existing tokens remain subject to their normal expiration and authorization rules.

If the stored audience differs from the current canonical `BTPM_MCP_RESOURCE_URI`, Platform Administration can reconcile the client by saving BTPM MCP again. The canonical URI is still resolved server-side.

## REST API runtime enablement

Registering a Connected App does not automatically enable the REST API runtime. The server controls are separate:

```text
BTPM_API_ENABLED
BTPM_API_READS_ENABLED
BTPM_API_MUTATIONS_ENABLED
BTPM_API_ALLOWED_ORIGINS
```

Keep mutations disabled unless they are intentionally required and tested.

`BTPM_API_ALLOWED_ORIGINS` is a browser CORS allowlist; it is not a substitute for OAuth authentication, Connected App authorization or BTPM business authority.

## Recommended setup sequence for an external client

1. Ensure BTPM user authentication works normally.
2. Enable only the required REST/MCP runtime surface.
3. Register the external application in Platform Admin.
4. Bind its OAuth client ID.
5. Add the exact redirect URI(s).
6. Configure/activate the required policy and consent state.
7. Enable only required capabilities.
8. For MCP, configure `BTPM_MCP_RESOURCE_URI` and select BTPM MCP protected resource.
9. Complete delegated OAuth authorization as an actual BTPM user with sufficient authority.
10. Test a harmless read before enabling mutations.
11. Review activity/connection evidence.

## Secrets

Do not place OAuth client secrets, access tokens or refresh tokens in the browser application or repository.

The current Connected App administration UI manages client identity, redirect, capability and policy configuration; it is not a generic secret vault for third-party credentials. Provider/integration secrets belong in the protected Tenant integration-secret system described in [OPTIONAL_INTEGRATIONS.md](./OPTIONAL_INTEGRATIONS.md).
