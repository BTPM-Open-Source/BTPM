# Authentication and Microsoft SSO

BTPM uses Supabase Auth as the application authentication authority. The web application currently supports email/password sign-in and Microsoft sign-in through Supabase's `azure` OAuth provider.

This is separate from BTPM Connected Apps. Connected Apps govern external REST/MCP clients; they do not replace end-user login.

## Email/password authentication

The BTPM sign-in page calls Supabase Auth with `signInWithPassword`. Configure email/password authentication in Supabase Auth according to your deployment policy.

Password reset is initiated from BTPM and completes at:

```text
https://<your-btpm-host>/reset-password
```

Add the deployed reset URL to the permitted Supabase Auth redirect URLs.

For the first installation, create the initial Auth user before running `supabase/bootstrap/first_install.sql`. The email in the bootstrap script must match exactly one Supabase Auth user.

## Microsoft sign-in architecture

The BTPM sign-in page invokes:

```text
Supabase Auth provider: azure
Requested scope: email
BTPM post-authentication route: /auth/callback
```

The flow is:

```text
Browser
  -> BTPM /auth
  -> Supabase Auth Azure provider
  -> Microsoft identity platform
  -> Supabase Auth callback
  -> BTPM /auth/callback
  -> invitation/access reconciliation
  -> requested BTPM route
```

There are therefore two callback concepts:

1. **Microsoft application registration → Supabase Auth callback.** Configure the callback URL shown by Supabase for the Azure provider in your Microsoft application registration. For hosted Supabase projects this is normally under the project's `/auth/v1/callback` endpoint.
2. **Supabase Auth → BTPM web callback.** BTPM requests a redirect back to `https://<your-btpm-host>/auth/callback`. This URL must be allowed by Supabase Auth redirect configuration.

Do not register only the BTPM `/auth/callback` URL in Microsoft and bypass the Supabase provider flow; the application code expects Supabase to complete the provider exchange.

## Microsoft application registration

Create a Microsoft/Entra application suitable for your organization and configure it as the Azure provider in Supabase Auth. Supply the provider credentials to Supabase, not to browser code.

Use the account/tenant policy appropriate for your organization. BTPM itself does not hard-code a Microsoft tenant ID for end-user login.

The current BTPM login requests only the `email` scope from the Supabase Azure provider. Do not add Microsoft Graph application permissions merely to make BTPM user sign-in work.

## BTPM access after Microsoft authentication

Successful Microsoft authentication is not sufficient to enter BTPM. The `/auth/callback` code:

- exchanges the authorization code for a Supabase session;
- ensures the BTPM profile exists;
- attempts to redeem a pending BTPM invitation matching the authenticated email;
- refuses application access when no BTPM access has been assigned.

This preserves BTPM membership and Tenant/Organization/Workspace authority instead of treating every identity from the Microsoft tenant as automatically authorized.

## Supabase Auth URL configuration

Configure the BTPM production origin as the Supabase Auth Site URL and allow the exact redirect URLs used by the deployment, including at least:

```text
https://<your-btpm-host>/auth/callback
https://<your-btpm-host>/reset-password
```

Add localhost/development URLs only where needed for development. Remove obsolete or overly broad redirects before production use.

## Invitations and onboarding

The canonical Microsoft SSO onboarding path is invitation-aware. Administrators should assign/invite users through BTPM governance, then users may authenticate with the matching Microsoft email. Do not replace this with a blanket rule that grants BTPM access to every authenticated Microsoft account.

## Microsoft Graph and SharePoint are different integrations

Microsoft login SSO does **not** configure Microsoft Graph or SharePoint runtime access.

BTPM's Microsoft Graph integration uses its own protected Tenant integration credentials:

```text
tenant_id
client_id
client_secret
```

SharePoint uses protected site configuration and reuses the configured Microsoft Graph credentials. See [OPTIONAL_INTEGRATIONS.md](./OPTIONAL_INTEGRATIONS.md).

## What is not implied by this guide

This repository documents the Microsoft OAuth login flow implemented by the current application. Do not assume that SAML, arbitrary enterprise identity providers, SCIM provisioning or automatic Microsoft-group-to-BTPM-role mapping are enabled unless you implement and review those capabilities separately.

## Security checklist

- Keep Microsoft provider secrets in Supabase/server configuration, never `VITE_*` variables.
- Use exact redirect URLs.
- Require BTPM invitation/membership authority after authentication.
- Do not grant Graph permissions just for login.
- Do not expose OAuth tokens or provider errors containing credentials in logs.
- Test sign-in with an invited user and a valid-but-uninvited Microsoft user before production rollout.
