/**
 * SP UX correction — MSAL SPA redirect landing page.
 *
 * Required so that the redirect URI registered in Azure AD
 * (`${origin}/auth/ms-callback`) resolves to a real page in this SPA.
 * MSAL's popup/ssoSilent flows post the auth response back to the opener
 * automatically; this component just renders a benign placeholder while
 * the popup closes.
 */
export default function MsAuthCallback() {
  return (
    <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
      Completing Microsoft sign-in…
    </div>
  );
}
