/**
 * Tenant Integration Secret requirement catalog.
 *
 * Logical secret names only. Never contains values, fingerprints, or Vault IDs.
 * Must stay in sync with the backend allow-list
 * `public._is_allowed_tenant_integration_secret_name`.
 * Runtime integrations resolve these logical names through protected tenant
 * integration configuration; this catalog never contains credential values.
 */

export type IntegrationKind =
  | "openai"
  | "azure_openai"
  | "microsoft_graph"
  | "sharepoint"
  | "mulesoft_kpi"
  | "smtp";

export type SecretInputType = "password" | "text" | "url" | "email" | "number";

export interface SecretRequirement {
  /** Logical secret name — matches backend allow-list. */
  name: string;
  label: string;
  description: string;
  required: boolean;
  tenantAllowed: boolean;
  organizationOverrideAllowed: boolean;
  inputType: SecretInputType;
  placeholder?: string;
  multiline?: boolean;
  /** Passed as `secret_kind` when storing. */
  secretKind: string;
}

export interface IntegrationCatalogEntry {
  kind: IntegrationKind;
  label: string;
  description: string;
  secrets: SecretRequirement[];
}

const PWD = (name: string, label: string, req = true, desc = ""): SecretRequirement => ({
  name, label, description: desc, required: req,
  tenantAllowed: true, organizationOverrideAllowed: true,
  inputType: "password", secretKind: "secret",
});
const TXT = (name: string, label: string, req = true, desc = "", placeholder?: string): SecretRequirement => ({
  name, label, description: desc, required: req,
  tenantAllowed: true, organizationOverrideAllowed: true,
  inputType: "text", placeholder, secretKind: "text",
});
const URL_ = (name: string, label: string, req = true, desc = "", placeholder?: string): SecretRequirement => ({
  name, label, description: desc, required: req,
  tenantAllowed: true, organizationOverrideAllowed: true,
  inputType: "url", placeholder, secretKind: "text",
});
const NUM = (name: string, label: string, req = true, desc = "", placeholder?: string): SecretRequirement => ({
  name, label, description: desc, required: req,
  tenantAllowed: true, organizationOverrideAllowed: true,
  inputType: "number", placeholder, secretKind: "text",
});
const EMAIL = (name: string, label: string, req = true, desc = ""): SecretRequirement => ({
  name, label, description: desc, required: req,
  tenantAllowed: true, organizationOverrideAllowed: true,
  inputType: "email", secretKind: "text",
});

export const INTEGRATION_SECRET_CATALOG: Record<IntegrationKind, IntegrationCatalogEntry> = {
  openai: {
    kind: "openai",
    label: "OpenAI",
    description:
      "OpenAI API credential for BTPM copilots and generators. Only the API key is stored here. AI models are selected through BTPM AI Settings; Azure OpenAI is configured through its own separate integration.",
    secrets: [
      PWD("api_key", "API key", true, "OpenAI API key (sk-...)."),
    ],
  },
  azure_openai: {
    kind: "azure_openai",
    label: "Azure OpenAI",
    description:
      "Azure-hosted OpenAI. Only the API key is stored here. The Azure resource endpoint is non-secret configuration and is managed in the Azure OpenAI configuration section. Model deployments will be mapped in a later AI-provider step.",
    secrets: [
      PWD("api_key", "API key", true, "Azure OpenAI resource key."),
    ],
  },
  microsoft_graph: {
    kind: "microsoft_graph",
    label: "Microsoft Graph",
    description:
      "Microsoft 365 tenant credentials for Graph API calls. Graph-mail sender identity (from address / display name) is handled as a separate email configuration item.",
    secrets: [
      TXT("tenant_id", "Microsoft tenant ID", true),
      TXT("client_id", "Application (client) ID", true),
      PWD("client_secret", "Client secret", true),
    ],
  },
  sharepoint: {
    kind: "sharepoint",
    label: "SharePoint",
    description:
      "SharePoint publishing target. Reuses Microsoft Graph credentials — only the site coordinates are stored here.",
    secrets: [
      URL_("site_url", "Site URL", true, "", "https://<tenant>.sharepoint.com/sites/<site>"),
      TXT("site_id", "Site ID", false, "Optional Graph site identifier ({hostname},{site-collection-id},{site-id})."),
    ],
  },
  mulesoft_kpi: {
    kind: "mulesoft_kpi",
    label: "MuleSoft KPI",
    description: "MuleSoft KPI submission endpoint credentials.",
    secrets: [
      URL_("api_url", "API URL", true, "", "https://<mulesoft-host>/api/kpi"),
      TXT("username", "Username", true),
      PWD("password", "Password", true),
    ],
  },
  smtp: {
    kind: "smtp",
    label: "SMTP",
    description: "Outbound email transport. Runtime use is blocked in non-production.",
    secrets: [
      TXT("host", "SMTP host", true, "", "smtp.example.com"),
      NUM("port", "SMTP port", true, "", "587"),
      TXT("username", "Username", false),
      PWD("password", "Password", true),
      EMAIL("from_email", "From address", true),
      TXT("from_name", "From name", false),
    ],
  },
};

export function getCatalog(kind: string): IntegrationCatalogEntry | null {
  return (INTEGRATION_SECRET_CATALOG as Record<string, IntegrationCatalogEntry>)[kind] ?? null;
}
