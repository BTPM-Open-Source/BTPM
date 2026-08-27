import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SaasAdminShell, AdminLoadingCards, AdminEmptyState } from "./SaasAdminShell";
import { ApiClientActivityPanel } from "./ApiClientActivityPanel";
import { groupCapabilitiesByDomain } from "./apiCapabilityDomains";
import { McpConnectionCard } from "./McpConnectionCard";


/** API-ADM.2A — URL-addressable tab model for the Platform API client detail page. */
export const API_CLIENT_DETAIL_TABS = [
  { value: "overview", label: "Overview" },
  { value: "oauth", label: "OAuth" },
  { value: "capabilities", label: "Supported capabilities" },
  { value: "policy", label: "Policy & consent" },
  { value: "activity", label: "API activity" },
] as const;

export type ApiClientDetailTab = (typeof API_CLIENT_DETAIL_TABS)[number]["value"];

export const DEFAULT_API_CLIENT_DETAIL_TAB: ApiClientDetailTab = "overview";

export function resolveApiClientDetailTab(value: string | null): ApiClientDetailTab {
  const match = API_CLIENT_DETAIL_TABS.find((tab) => tab.value === value);
  return match ? match.value : DEFAULT_API_CLIENT_DETAIL_TAB;
}


interface ClientRecord {
  id: string;
  client_key: string;
  display_name: string;
  description: string | null;
  oauth_client_id: string | null;
  /** UX-MCP-ADMIN.2 — persisted per-client protected-resource configuration. */
  oauth_resource_audience: string | null;
  protected_resource_type: "none" | "btpm_mcp";
  lifecycle_status: string;
  created_at: string;
  updated_at: string;
}

interface RedirectRecord {
  id: string;
  redirect_uri: string;
  lifecycle_status: string;
  verified_at: string | null;
  retired_at: string | null;
}

interface PolicyVersionRecord {
  id: string;
  version: string;
  policy_uri: string | null;
  lifecycle_status: string;
  effective_at: string | null;
  retired_at: string | null;
}

interface SupportedCapabilityRecord {
  supported_capability_id: string | null;
  api_version: string;
  capability_kind: string;
  capability_key: string;
  display_name: string;
  description?: string | null;
  http_method: string | null;
  route_path: string | null;
  catalogue_lifecycle_status?: string | null;
  administrator_assignable?: boolean | null;
  support_lifecycle_status: string | null;
}

interface ClientDetail {
  client: ClientRecord;
  redirects: RedirectRecord[];
  policy_versions: PolicyVersionRecord[];
  supported_capabilities: SupportedCapabilityRecord[];
}

function statusVariant(status: string): "default" | "secondary" | "outline" {
  if (status === "active" || status === "enabled") return "default";
  if (status === "retired") return "outline";
  return "secondary";
}

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleDateString() : "—";
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-sm text-foreground">{value}</div>
    </div>
  );
}

export default function AdminPlatformApiClientDetail() {
  const { clientId } = useParams<{ clientId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = resolveApiClientDetailTab(searchParams.get("tab"));
  const handleTabChange = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", resolveApiClientDetailTab(value));
    setSearchParams(next, { replace: false });
  };
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editOauthClientId, setEditOauthClientId] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [editPending, setEditPending] = useState(false);

  const [redirectOpen, setRedirectOpen] = useState(false);
  const [redirectUri, setRedirectUri] = useState("");
  const [redirectError, setRedirectError] = useState<string | null>(null);
  const [redirectPending, setRedirectPending] = useState(false);

  const [editRedirectId, setEditRedirectId] = useState<string | null>(null);
  const [editRedirectUri, setEditRedirectUri] = useState("");
  const [editRedirectError, setEditRedirectError] = useState<string | null>(null);
  const [editRedirectPending, setEditRedirectPending] = useState(false);

  const [activateRedirect, setActivateRedirect] = useState<RedirectRecord | null>(null);
  const [activateError, setActivateError] = useState<string | null>(null);
  const [activatePending, setActivatePending] = useState(false);

  const [retireRedirect, setRetireRedirect] = useState<RedirectRecord | null>(null);
  const [retireError, setRetireError] = useState<string | null>(null);
  const [retirePending, setRetirePending] = useState(false);

  const redirectTransitionPending = activatePending || retirePending;

  const [policyOpen, setPolicyOpen] = useState(false);
  const [policyVersion, setPolicyVersion] = useState("");
  const [policyUri, setPolicyUri] = useState("");
  const [policyDocument, setPolicyDocument] = useState("");
  const [policyError, setPolicyError] = useState<string | null>(null);
  const [policyPending, setPolicyPending] = useState(false);

  const [editPolicyId, setEditPolicyId] = useState<string | null>(null);
  const [editPolicyVersion, setEditPolicyVersion] = useState("");
  const [editPolicyUri, setEditPolicyUri] = useState("");
  const [editPolicyDocument, setEditPolicyDocument] = useState("");
  const [editPolicyError, setEditPolicyError] = useState<string | null>(null);
  const [editPolicyPending, setEditPolicyPending] = useState(false);

  const [activatePolicy, setActivatePolicy] = useState<PolicyVersionRecord | null>(null);
  const [activatePolicyError, setActivatePolicyError] = useState<string | null>(null);
  const [activatePolicyPending, setActivatePolicyPending] = useState(false);

  const [retirePolicy, setRetirePolicy] = useState<PolicyVersionRecord | null>(null);
  const [retirePolicyError, setRetirePolicyError] = useState<string | null>(null);
  const [retirePolicyPending, setRetirePolicyPending] = useState(false);

  const [enableCapability, setEnableCapability] = useState<SupportedCapabilityRecord | null>(null);
  const [enableCapabilityError, setEnableCapabilityError] = useState<string | null>(null);
  const [enableCapabilityPending, setEnableCapabilityPending] = useState(false);
  const [disableCapability, setDisableCapability] = useState<SupportedCapabilityRecord | null>(null);
  const [disableCapabilityError, setDisableCapabilityError] = useState<string | null>(null);
  const [disableCapabilityPending, setDisableCapabilityPending] = useState(false);
  const capabilityTransitionPending = enableCapabilityPending || disableCapabilityPending;

  const [activateClientOpen, setActivateClientOpen] = useState(false);
  const [activateClientError, setActivateClientError] = useState<string | null>(null);
  const [activateClientPending, setActivateClientPending] = useState(false);

  const [suspendClientOpen, setSuspendClientOpen] = useState(false);
  const [suspendClientError, setSuspendClientError] = useState<string | null>(null);
  const [suspendClientPending, setSuspendClientPending] = useState(false);

  const [reactivateClientOpen, setReactivateClientOpen] = useState(false);
  const [reactivateClientError, setReactivateClientError] = useState<string | null>(null);
  const [reactivateClientPending, setReactivateClientPending] = useState(false);

  const [retireClientOpen, setRetireClientOpen] = useState(false);
  const [retireClientError, setRetireClientError] = useState<string | null>(null);
  const [retireClientPending, setRetireClientPending] = useState(false);

  const clientLifecycleTransitionPending =
    activateClientPending ||
    suspendClientPending ||
    reactivateClientPending ||
    retireClientPending;




  const { data, isLoading, error } = useQuery({
    queryKey: ["platform-admin-api-client", clientId],
    enabled: !!clientId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("api_g_5_6_platform_get_client", {
        _api_client_id: clientId,
      });
      if (error) throw error;
      return data as ClientDetail;
    },
  });

  const client = data?.client;
  const redirects = data?.redirects ?? [];
  const policyVersions = data?.policy_versions ?? [];
  const capabilities = data?.supported_capabilities ?? [];

  const trimmedName = editName.trim();
  const oauthValid =
    editOauthClientId.length === 0 ||
    (editOauthClientId === editOauthClientId.trim() &&
      editOauthClientId === editOauthClientId.toLowerCase());
  const editValid = trimmedName.length > 0 && oauthValid;

  const redirectValid =
    redirectUri.length > 0 &&
    redirectUri === redirectUri.trim() &&
    redirectUri.startsWith("https://") &&
    !/[\s*#]/.test(redirectUri) &&
    redirectUri.length <= 2048;

  const editRedirectValid =
    editRedirectUri.length > 0 &&
    editRedirectUri === editRedirectUri.trim() &&
    editRedirectUri.startsWith("https://") &&
    !/[\s*#]/.test(editRedirectUri) &&
    editRedirectUri.length <= 2048;

  const utf8Bytes = (v: string) => new TextEncoder().encode(v).length;

  const policyVersionValid = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(policyVersion);

  const policyUriValid =
    policyUri.length > 0 &&
    policyUri === policyUri.trim() &&
    policyUri.startsWith("https://") &&
    // eslint-disable-next-line no-control-regex
    !/[\s\u0000-\u001f\u007f]/.test(policyUri) &&
    utf8Bytes(policyUri) <= 2048;

  const policyDocumentValid =
    policyDocument.trim().length > 0 && utf8Bytes(policyDocument) <= 1_048_576;

  const policyValid = policyVersionValid && policyUriValid && policyDocumentValid;

  const editPolicyVersionValid = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(editPolicyVersion);

  const editPolicyUriValid =
    editPolicyUri.length > 0 &&
    editPolicyUri === editPolicyUri.trim() &&
    editPolicyUri.startsWith("https://") &&
    // eslint-disable-next-line no-control-regex
    !/[\s\u0000-\u001f\u007f]/.test(editPolicyUri) &&
    utf8Bytes(editPolicyUri) <= 2048;

  const editPolicyDocumentValid =
    editPolicyDocument.trim().length > 0 && utf8Bytes(editPolicyDocument) <= 1_048_576;

  const editPolicyValid =
    editPolicyVersionValid && editPolicyUriValid && editPolicyDocumentValid;

  const policyTransitionPending =
    editPolicyPending || activatePolicyPending || retirePolicyPending;

  function openPolicy() {
    setPolicyVersion("");
    setPolicyUri("");
    setPolicyDocument("");
    setPolicyError(null);
    setPolicyOpen(true);
  }

  function closePolicy() {
    setPolicyOpen(false);
    setPolicyVersion("");
    setPolicyUri("");
    setPolicyDocument("");
    setPolicyError(null);
  }

  async function handleCreatePolicyVersion() {
    if (!client || !policyValid || policyPending) return;
    setPolicyPending(true);
    setPolicyError(null);
    try {
      const { error: rpcError } = await (supabase.rpc as any)(
        "api_g_5_5_platform_create_policy_version",
        {
          _api_client_id: client.id,
          _version: policyVersion,
          _policy_uri: policyUri,
          _policy_document: policyDocument,
        },
      );
      if (rpcError) throw rpcError;
      await queryClient.invalidateQueries({
        queryKey: ["platform-admin-api-client", client.id],
      });
      closePolicy();
    } catch {
      setPolicyError(
        "Could not create this policy version. Please review the values and try again.",
      );
    } finally {
      setPolicyPending(false);
    }
  }

  function openEditPolicy(p: PolicyVersionRecord) {
    setEditPolicyId(p.id);
    setEditPolicyVersion(p.version ?? "");
    setEditPolicyUri(p.policy_uri ?? "");
    setEditPolicyDocument("");
    setEditPolicyError(null);
  }

  function closeEditPolicy() {
    setEditPolicyId(null);
    setEditPolicyVersion("");
    setEditPolicyUri("");
    setEditPolicyDocument("");
    setEditPolicyError(null);
  }

  async function handleUpdateDraftPolicyVersion() {
    if (!client || !editPolicyId || !editPolicyValid || editPolicyPending) return;
    setEditPolicyPending(true);
    setEditPolicyError(null);
    try {
      const { error: rpcError } = await (supabase.rpc as any)(
        "api_g_5_5_platform_update_draft_policy_version",
        {
          _policy_version_id: editPolicyId,
          _version: editPolicyVersion,
          _policy_uri: editPolicyUri,
          _policy_document: editPolicyDocument,
        },
      );
      if (rpcError) throw rpcError;
      await queryClient.invalidateQueries({
        queryKey: ["platform-admin-api-client", client.id],
      });
      closeEditPolicy();
    } catch {
      setEditPolicyError(
        "Could not update this policy version. Please review the values and try again.",
      );
    } finally {
      setEditPolicyPending(false);
    }
  }

  function closeActivatePolicy() {
    setActivatePolicy(null);
    setActivatePolicyError(null);
  }

  async function handleActivatePolicyVersion() {
    if (!client || !activatePolicy?.id || activatePolicyPending) return;
    setActivatePolicyPending(true);
    setActivatePolicyError(null);
    try {
      const { error: rpcError } = await (supabase.rpc as any)(
        "api_g_5_5_platform_transition_policy_version",
        {
          _policy_version_id: activatePolicy.id,
          _target_lifecycle_status: "active",
        },
      );
      if (rpcError) throw rpcError;
      await queryClient.invalidateQueries({
        queryKey: ["platform-admin-api-client", client.id],
      });
      await queryClient.invalidateQueries({
        queryKey: ["platform-admin-api-clients"],
      });
      closeActivatePolicy();
    } catch {
      setActivatePolicyError("Could not activate this policy version. Please try again.");
    } finally {
      setActivatePolicyPending(false);
    }
  }

  function closeRetirePolicy() {
    setRetirePolicy(null);
    setRetirePolicyError(null);
  }

  async function handleRetirePolicyVersion() {
    if (!client || !retirePolicy?.id || retirePolicyPending) return;
    setRetirePolicyPending(true);
    setRetirePolicyError(null);
    try {
      const { error: rpcError } = await (supabase.rpc as any)(
        "api_g_5_5_platform_transition_policy_version",
        {
          _policy_version_id: retirePolicy.id,
          _target_lifecycle_status: "retired",
        },
      );
      if (rpcError) throw rpcError;
      await queryClient.invalidateQueries({
        queryKey: ["platform-admin-api-client", client.id],
      });
      await queryClient.invalidateQueries({
        queryKey: ["platform-admin-api-clients"],
      });
      closeRetirePolicy();
    } catch {
      setRetirePolicyError("Could not retire this policy version. Please try again.");
    } finally {
      setRetirePolicyPending(false);
    }
  }

  function closeEnableCapability() {
    setEnableCapability(null);
    setEnableCapabilityError(null);
  }

  async function handleEnableCapability() {
    if (!client || !enableCapability || capabilityTransitionPending) return;
    setEnableCapabilityPending(true);
    setEnableCapabilityError(null);
    try {
      const { error: rpcError } = await (supabase.rpc as any)(
        "api_g_5_6_platform_transition_supported_capability",
        {
          _api_client_id: client.id,
          _api_version: enableCapability.api_version,
          _capability_kind: enableCapability.capability_kind,
          _capability_key: enableCapability.capability_key,
          _target_lifecycle_status: "enabled",
        },
      );
      if (rpcError) throw rpcError;
      await queryClient.invalidateQueries({
        queryKey: ["platform-admin-api-client", client.id],
      });
      await queryClient.invalidateQueries({
        queryKey: ["platform-admin-api-clients"],
      });
      closeEnableCapability();
    } catch {
      setEnableCapabilityError("Could not enable this capability. Please try again.");
    } finally {
      setEnableCapabilityPending(false);
    }
  }

  function closeDisableCapability() {
    setDisableCapability(null);
    setDisableCapabilityError(null);
  }

  async function handleDisableCapability() {
    if (!client || !disableCapability || capabilityTransitionPending) return;
    setDisableCapabilityPending(true);
    setDisableCapabilityError(null);
    try {
      const { error: rpcError } = await (supabase.rpc as any)(
        "api_g_5_6_platform_transition_supported_capability",
        {
          _api_client_id: client.id,
          _api_version: disableCapability.api_version,
          _capability_kind: disableCapability.capability_kind,
          _capability_key: disableCapability.capability_key,
          _target_lifecycle_status: "disabled",
        },
      );
      if (rpcError) throw rpcError;
      await queryClient.invalidateQueries({
        queryKey: ["platform-admin-api-client", client.id],
      });
      await queryClient.invalidateQueries({
        queryKey: ["platform-admin-api-clients"],
      });
      closeDisableCapability();
    } catch {
      setDisableCapabilityError("Could not disable this capability. Please try again.");
    } finally {
      setDisableCapabilityPending(false);
    }
  }



  function openEdit() {
    if (!client) return;
    setEditName(client.display_name ?? "");
    setEditDescription(client.description ?? "");
    setEditOauthClientId(client.oauth_client_id ?? "");
    setEditError(null);
    setEditOpen(true);
  }

  function closeEdit() {
    setEditOpen(false);
    setEditName("");
    setEditDescription("");
    setEditOauthClientId("");
    setEditError(null);
  }

  function openRedirect() {
    setRedirectUri("");
    setRedirectError(null);
    setRedirectOpen(true);
  }

  function closeRedirect() {
    setRedirectOpen(false);
    setRedirectUri("");
    setRedirectError(null);
  }

  async function handleUpdate() {
    if (!client || !editValid || editPending) return;
    setEditPending(true);
    setEditError(null);
    try {
      const { error: rpcError } = await (supabase.rpc as any)(
        "api_g_5_5_platform_update_draft_client",
        {
          _api_client_id: client.id,
          _display_name: trimmedName,
          _description: editDescription.trim().length > 0 ? editDescription.trim() : null,
          _oauth_client_id: editOauthClientId.length > 0 ? editOauthClientId : null,
        },
      );
      if (rpcError) throw rpcError;
      await queryClient.invalidateQueries({
        queryKey: ["platform-admin-api-client", client.id],
      });
      await queryClient.invalidateQueries({ queryKey: ["platform-admin-api-clients"] });
      closeEdit();
    } catch {
      setEditError("Could not update this API client. Please review the values and try again.");
    } finally {
      setEditPending(false);
    }
  }

  async function handleCreateRedirect() {
    if (!client || !redirectValid || redirectPending) return;
    setRedirectPending(true);
    setRedirectError(null);
    try {
      const { error: rpcError } = await (supabase.rpc as any)(
        "api_g_5_5_platform_create_oauth_redirect",
        {
          _api_client_id: client.id,
          _redirect_uri: redirectUri,
        },
      );
      if (rpcError) throw rpcError;
      await queryClient.invalidateQueries({
        queryKey: ["platform-admin-api-client", client.id],
      });
      await queryClient.invalidateQueries({ queryKey: ["platform-admin-api-clients"] });
      closeRedirect();
    } catch {
      setRedirectError("Could not add this redirect URI. Please review the value and try again.");
    } finally {
      setRedirectPending(false);
    }
  }

  function openEditRedirect(r: RedirectRecord) {
    setEditRedirectId(r.id);
    setEditRedirectUri(r.redirect_uri);
    setEditRedirectError(null);
  }

  function closeEditRedirect() {
    setEditRedirectId(null);
    setEditRedirectUri("");
    setEditRedirectError(null);
  }

  async function handleUpdateRedirect() {
    if (!client || !editRedirectId || !editRedirectValid || editRedirectPending) return;
    setEditRedirectPending(true);
    setEditRedirectError(null);
    try {
      const { error: rpcError } = await (supabase.rpc as any)(
        "api_g_5_5_platform_update_draft_oauth_redirect",
        {
          _redirect_id: editRedirectId,
          _redirect_uri: editRedirectUri,
        },
      );
      if (rpcError) throw rpcError;
      await queryClient.invalidateQueries({
        queryKey: ["platform-admin-api-client", client.id],
      });
      closeEditRedirect();
    } catch {
      setEditRedirectError(
        "Could not update this redirect URI. Please review the value and try again.",
      );
    } finally {
      setEditRedirectPending(false);
    }
  }

  function closeActivateRedirect() {
    setActivateRedirect(null);
    setActivateError(null);
  }

  async function handleActivateRedirect() {
    if (!client || !activateRedirect?.id || redirectTransitionPending) return;
    setActivatePending(true);
    setActivateError(null);
    try {
      const { error: rpcError } = await (supabase.rpc as any)(
        "api_g_5_5_platform_transition_oauth_redirect",
        {
          _redirect_id: activateRedirect.id,
          _target_lifecycle_status: "active",
        },
      );
      if (rpcError) throw rpcError;
      await queryClient.invalidateQueries({
        queryKey: ["platform-admin-api-client", client.id],
      });
      await queryClient.invalidateQueries({
        queryKey: ["platform-admin-api-clients"],
      });
      closeActivateRedirect();
    } catch {
      setActivateError("Could not activate this redirect URI. Please try again.");
    } finally {
      setActivatePending(false);
    }
  }

  function closeActivateClient() {
    if (activateClientPending) return;
    setActivateClientOpen(false);
    setActivateClientError(null);
  }

  function closeSuspendClient() {
    if (suspendClientPending) return;
    setSuspendClientOpen(false);
    setSuspendClientError(null);
  }

  function closeReactivateClient() {
    if (reactivateClientPending) return;
    setReactivateClientOpen(false);
    setReactivateClientError(null);
  }

  function closeRetireClient() {
    if (retireClientPending) return;
    setRetireClientOpen(false);
    setRetireClientError(null);
  }

  async function handleRetireClient() {
    if (!client || clientLifecycleTransitionPending) return;
    setRetireClientPending(true);
    setRetireClientError(null);
    try {
      const { error: rpcError } = await (supabase.rpc as any)(
        "api_g_5_5_platform_transition_client",
        {
          _api_client_id: client.id,
          _target_lifecycle_status: "retired",
        },
      );
      if (rpcError) throw rpcError;
      await queryClient.invalidateQueries({
        queryKey: ["platform-admin-api-client", client.id],
      });
      await queryClient.invalidateQueries({
        queryKey: ["platform-admin-api-clients"],
      });
      setRetireClientOpen(false);
      setRetireClientError(null);
    } catch {
      setRetireClientError("Could not retire this API client. Please try again.");
    } finally {
      setRetireClientPending(false);
    }
  }

  async function handleReactivateClient() {
    if (!client || clientLifecycleTransitionPending) return;
    setReactivateClientPending(true);
    setReactivateClientError(null);
    try {
      const { error: rpcError } = await (supabase.rpc as any)(
        "api_g_5_5_platform_transition_client",
        {
          _api_client_id: client.id,
          _target_lifecycle_status: "active",
        },
      );
      if (rpcError) throw rpcError;
      await queryClient.invalidateQueries({
        queryKey: ["platform-admin-api-client", client.id],
      });
      await queryClient.invalidateQueries({
        queryKey: ["platform-admin-api-clients"],
      });
      setReactivateClientOpen(false);
      setReactivateClientError(null);
    } catch {
      setReactivateClientError(
        "Could not reactivate this API client. Please verify its OAuth configuration and try again.",
      );
    } finally {
      setReactivateClientPending(false);
    }
  }


  async function handleActivateClient() {
    if (!client || clientLifecycleTransitionPending) return;
    setActivateClientPending(true);
    setActivateClientError(null);
    try {
      const { error: rpcError } = await (supabase.rpc as any)(
        "api_g_5_5_platform_transition_client",
        {
          _api_client_id: client.id,
          _target_lifecycle_status: "active",
        },
      );
      if (rpcError) throw rpcError;
      await queryClient.invalidateQueries({
        queryKey: ["platform-admin-api-client", client.id],
      });
      await queryClient.invalidateQueries({
        queryKey: ["platform-admin-api-clients"],
      });
      setActivateClientOpen(false);
      setActivateClientError(null);
    } catch {
      setActivateClientError(
        "Could not activate this API client. Please verify its OAuth configuration and try again.",
      );
    } finally {
      setActivateClientPending(false);
    }
  }

  async function handleSuspendClient() {
    if (!client || clientLifecycleTransitionPending) return;
    setSuspendClientPending(true);
    setSuspendClientError(null);
    try {
      const { error: rpcError } = await (supabase.rpc as any)(
        "api_g_5_5_platform_transition_client",
        {
          _api_client_id: client.id,
          _target_lifecycle_status: "suspended",
        },
      );
      if (rpcError) throw rpcError;
      await queryClient.invalidateQueries({
        queryKey: ["platform-admin-api-client", client.id],
      });
      await queryClient.invalidateQueries({
        queryKey: ["platform-admin-api-clients"],
      });
      setSuspendClientOpen(false);
      setSuspendClientError(null);
    } catch {
      setSuspendClientError("Could not suspend this API client. Please try again.");
    } finally {
      setSuspendClientPending(false);
    }
  }


  function closeRetireRedirect() {

    setRetireRedirect(null);
    setRetireError(null);
  }

  async function handleRetireRedirect() {
    if (!client || !retireRedirect?.id || redirectTransitionPending) return;
    setRetirePending(true);
    setRetireError(null);
    try {
      const { error: rpcError } = await (supabase.rpc as any)(
        "api_g_5_5_platform_transition_oauth_redirect",
        {
          _redirect_id: retireRedirect.id,
          _target_lifecycle_status: "retired",
        },
      );
      if (rpcError) throw rpcError;
      await queryClient.invalidateQueries({
        queryKey: ["platform-admin-api-client", client.id],
      });
      await queryClient.invalidateQueries({
        queryKey: ["platform-admin-api-clients"],
      });
      closeRetireRedirect();
    } catch {
      setRetireError(
        "Could not retire this redirect URI. The current client configuration may require it to remain active.",
      );
    } finally {
      setRetirePending(false);
    }
  }



  return (
    <SaasAdminShell
      title={client?.display_name ?? "Client details"}
      scope="platform"
      crumbs={[
        { label: "Platform", to: "/admin/platform" },
        { label: "API clients", to: "/admin/platform/api-clients" },
        { label: client?.display_name ?? "Client details" },
      ]}
    >
      {isLoading && <AdminLoadingCards count={3} />}

      {!isLoading && (error || !client) && (
        <Card>
          <CardContent className="py-10 flex flex-col items-center text-center gap-2">
            <p className="text-sm font-medium text-foreground">API client is not available</p>
            <Link
              to="/admin/platform/api-clients"
              className="text-xs text-primary hover:underline"
            >
              Back to API clients
            </Link>
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && client && (
        <>
          <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-5">
            <TabsList className="flex w-full flex-wrap justify-start h-auto">
              {API_CLIENT_DETAIL_TABS.map((tab) => (
                <TabsTrigger key={tab.value} value={tab.value}>
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>

          <TabsContent value="overview" className="mt-0">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
              <CardTitle className="text-base">Client overview</CardTitle>
              <div className="flex items-center gap-2">
                {client.lifecycle_status === "draft" && (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={openEdit}
                      disabled={clientLifecycleTransitionPending}
                    >
                      Edit client
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => {
                        setActivateClientError(null);
                        setActivateClientOpen(true);
                      }}
                      disabled={clientLifecycleTransitionPending}
                    >
                      Activate
                    </Button>
                  </>
                )}

                {client.lifecycle_status === "active" && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      setSuspendClientError(null);
                      setSuspendClientOpen(true);
                    }}
                    disabled={clientLifecycleTransitionPending}
                  >
                    Suspend
                  </Button>
                )}

                {client.lifecycle_status === "suspended" && (
                  <Button
                    size="sm"
                    onClick={() => {
                      setReactivateClientError(null);
                      setReactivateClientOpen(true);
                    }}
                    disabled={clientLifecycleTransitionPending}
                  >
                    Reactivate
                  </Button>
                )}

                {(client.lifecycle_status === "draft" ||
                  client.lifecycle_status === "active" ||
                  client.lifecycle_status === "suspended") && (
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => {
                      setRetireClientError(null);
                      setRetireClientOpen(true);
                    }}
                    disabled={clientLifecycleTransitionPending}
                  >
                    Retire
                  </Button>
                )}
              </div>


            </CardHeader>

            <CardContent className="grid gap-4 md:grid-cols-2">
              <DetailRow label="Display name" value={client.display_name} />
              <DetailRow
                label="Client key"
                value={<span className="font-mono text-xs">{client.client_key}</span>}
              />
              <DetailRow label="Description" value={client.description ?? "—"} />
              <DetailRow
                label="OAuth client ID"
                value={
                  client.oauth_client_id ? (
                    <span className="font-mono text-xs">{client.oauth_client_id}</span>
                  ) : (
                    "—"
                  )
                }
              />
              <DetailRow
                label="Lifecycle status"
                value={
                  <Badge variant={statusVariant(client.lifecycle_status)} className="font-normal">
                    {client.lifecycle_status}
                  </Badge>
                }
              />
              <DetailRow label="Created" value={formatDate(client.created_at)} />
              <DetailRow label="Last updated" value={formatDate(client.updated_at)} />
            </CardContent>
          </Card>
          </TabsContent>

          <TabsContent value="oauth" className="mt-0 space-y-4">
          <McpConnectionCard
            apiClientId={client.id}
            oauthClientId={client.oauth_client_id}
            lifecycleStatus={client.lifecycle_status}
            protectedResourceType={client.protected_resource_type}
            oauthResourceAudience={client.oauth_resource_audience}
          />

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
              <CardTitle className="text-base">OAuth redirect URIs</CardTitle>
              {client.lifecycle_status !== "retired" && (
                <Button variant="outline" size="sm" onClick={openRedirect}>
                  Add redirect URI
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {redirects.length === 0 ? (
                <div className="p-4">
                  <AdminEmptyState
                    title="No redirect URIs"
                    description="This client has no registered OAuth redirect URIs."
                  />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Redirect URI</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Verified</TableHead>
                      <TableHead>Retired</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {redirects.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-sm font-mono break-all">{r.redirect_uri}</TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(r.lifecycle_status)} className="font-normal">
                            {r.lifecycle_status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(r.verified_at)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(r.retired_at)}
                        </TableCell>
                        <TableCell className="text-right">
                          {(r.lifecycle_status === "draft" ||
                            r.lifecycle_status === "active") && (
                            <div className="flex justify-end gap-2">
                              {r.lifecycle_status === "draft" && (
                                <>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={redirectTransitionPending}
                                    onClick={() => openEditRedirect(r)}
                                  >
                                    Edit
                                  </Button>
                                  <Button
                                    size="sm"
                                    disabled={redirectTransitionPending}
                                    onClick={() => {
                                      setActivateError(null);
                                      setActivateRedirect(r);
                                    }}
                                  >
                                    Activate
                                  </Button>
                                </>
                              )}
                              <Button
                                variant="destructive"
                                size="sm"
                                disabled={redirectTransitionPending}
                                onClick={() => {
                                  setRetireError(null);
                                  setRetireRedirect(r);
                                }}
                              >
                                Retire
                              </Button>
                            </div>
                          )}
                        </TableCell>

                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          </TabsContent>

          <TabsContent value="policy" className="mt-0">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0">
              <CardTitle className="text-base">Policy versions</CardTitle>
              {client.lifecycle_status !== "retired" && (
                <Button variant="outline" size="sm" onClick={openPolicy}>
                  Add policy version
                </Button>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {policyVersions.length === 0 ? (
                <div className="p-4">
                  <AdminEmptyState
                    title="No policy versions"
                    description="This client has no registered policy versions."
                  />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Version</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Policy URI</TableHead>
                      <TableHead>Effective</TableHead>
                      <TableHead>Retired</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {policyVersions.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="text-sm font-medium text-foreground">
                          {p.version}
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(p.lifecycle_status)} className="font-normal">
                            {p.lifecycle_status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground break-all">
                          {p.policy_uri ?? "—"}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(p.effective_at)}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDate(p.retired_at)}
                        </TableCell>
                        <TableCell className="text-right">
                          {(p.lifecycle_status === "draft" ||
                            p.lifecycle_status === "active") && (
                            <div className="flex justify-end gap-2">
                              {p.lifecycle_status === "draft" && (
                                <>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => openEditPolicy(p)}
                                    disabled={policyTransitionPending}
                                  >
                                    Edit
                                  </Button>
                                  <Button
                                    size="sm"
                                    onClick={() => {
                                      setActivatePolicyError(null);
                                      setActivatePolicy(p);
                                    }}
                                    disabled={policyTransitionPending}
                                  >
                                    Activate
                                  </Button>
                                </>
                              )}
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => {
                                  setRetirePolicyError(null);
                                  setRetirePolicy(p);
                                }}
                                disabled={policyTransitionPending}
                              >
                                Retire
                              </Button>
                            </div>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
          </TabsContent>

          <TabsContent value="capabilities" className="mt-0">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Supported capabilities</CardTitle>
            </CardHeader>
            <CardContent className={capabilities.length === 0 ? "p-0" : "space-y-4"}>
              {capabilities.length === 0 ? (
                <div className="p-4">
                  <AdminEmptyState
                    title="No capabilities"
                    description="No assignable capabilities are available for this client."
                  />
                </div>
              ) : (
                groupCapabilitiesByDomain(capabilities).map((group) => (
                  <section
                    key={group.domain.id}
                    className="rounded-md border"
                    aria-labelledby={`cap-domain-${group.domain.id}`}
                  >
                    <div className="px-4 py-3 border-b bg-muted/30">
                      <h3
                        id={`cap-domain-${group.domain.id}`}
                        data-testid="cap-domain-heading"
                        className="text-sm font-semibold text-foreground"
                      >
                        {group.domain.label}
                      </h3>
                      <p className="text-xs text-muted-foreground">{group.domain.description}</p>
                    </div>
                    <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Capability</TableHead>
                      <TableHead>API version</TableHead>
                      <TableHead>Kind</TableHead>
                      <TableHead>Route</TableHead>
                      <TableHead>Support</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {group.capabilities.map((c) => (
                      <TableRow key={`${c.api_version}:${c.capability_kind}:${c.capability_key}`}>
                        <TableCell>
                          <p className="text-sm font-medium text-foreground">{c.display_name}</p>
                          <p className="text-xs text-muted-foreground font-mono">{c.capability_key}</p>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">{c.api_version}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {c.capability_kind}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground font-mono break-all">
                          {c.http_method ?? "—"} {c.route_path ?? ""}
                        </TableCell>
                        <TableCell>
                          {c.support_lifecycle_status === "enabled" && (
                            <Badge variant="default" className="font-normal">Enabled</Badge>
                          )}
                          {c.support_lifecycle_status === "disabled" && (
                            <Badge variant="secondary" className="font-normal">Disabled</Badge>
                          )}
                          {!c.support_lifecycle_status && (
                            <Badge variant="outline" className="font-normal">Not enabled</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {client.lifecycle_status !== "retired" &&
                          c.catalogue_lifecycle_status === "active" &&
                          c.administrator_assignable === true ? (
                            c.support_lifecycle_status === "enabled" ? (
                              <Button
                                size="sm"
                                variant="destructive"
                                disabled={capabilityTransitionPending}
                                onClick={() => {
                                  setDisableCapabilityError(null);
                                  setDisableCapability(c);
                                }}
                              >
                                Disable
                              </Button>
                            ) : c.support_lifecycle_status === "disabled" ||
                              c.support_lifecycle_status === null ||
                              c.support_lifecycle_status === undefined ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={capabilityTransitionPending}
                                onClick={() => {
                                  setEnableCapabilityError(null);
                                  setEnableCapability(c);
                                }}
                              >
                                Enable
                              </Button>
                            ) : null
                          ) : null}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                    </Table>
                  </section>
                ))
              )}
            </CardContent>
          </Card>
          </TabsContent>


          <TabsContent value="activity" className="mt-0">
          <ApiClientActivityPanel
            apiClientId={client.id}
            mode="platform"
            organizationId={null}
          />
          </TabsContent>
          </Tabs>

          <Dialog open={editOpen} onOpenChange={(open) => (open ? setEditOpen(true) : closeEdit())}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit API client</DialogTitle>
                <DialogDescription>
                  Metadata can only be edited while the client is in draft.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label>Client key</Label>
                  <Input value={client.client_key} readOnly disabled className="font-mono" />
                  <p className="text-xs text-muted-foreground">The client key cannot be changed.</p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-display-name">Display name</Label>
                  <Input
                    id="edit-display-name"
                    value={editName}
                    maxLength={200}
                    onChange={(e) => setEditName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-description">Description</Label>
                  <Textarea
                    id="edit-description"
                    value={editDescription}
                    maxLength={1000}
                    onChange={(e) => setEditDescription(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-oauth-client-id">OAuth client ID</Label>
                  <Input
                    id="edit-oauth-client-id"
                    value={editOauthClientId}
                    maxLength={200}
                    className="font-mono"
                    onChange={(e) => setEditOauthClientId(e.target.value)}
                  />
                  {!oauthValid && (
                    <p className="text-xs text-destructive">
                      OAuth client ID must be lowercase with no leading or trailing spaces.
                    </p>
                  )}
                </div>
                {editError && <p className="text-sm text-destructive">{editError}</p>}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeEdit} disabled={editPending}>
                  Cancel
                </Button>
                <Button onClick={handleUpdate} disabled={!editValid || editPending}>
                  {editPending ? "Saving…" : "Save changes"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog
            open={activateClientOpen}
            onOpenChange={(open) => {
              if (!open) closeActivateClient();
            }}
          >
            <DialogContent
              onEscapeKeyDown={(e) => {
                if (activateClientPending) e.preventDefault();
              }}
              onPointerDownOutside={(e) => {
                if (activateClientPending) e.preventDefault();
              }}
              onInteractOutside={(e) => {
                if (activateClientPending) e.preventDefault();
              }}
            >
              <DialogHeader>
                <DialogTitle>Activate API client</DialogTitle>
                <DialogDescription>
                  This moves the client from draft to active.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 text-sm">
                <div className="space-y-1">
                  <DetailRow label="Display name" value={client.display_name} />
                  <DetailRow
                    label="Client key"
                    value={<span className="font-mono text-xs">{client.client_key}</span>}
                  />
                  <DetailRow
                    label="OAuth client ID"
                    value={
                      client.oauth_client_id ? (
                        <span className="font-mono text-xs">{client.oauth_client_id}</span>
                      ) : (
                        <span className="text-destructive">Not linked</span>
                      )
                    }
                  />
                  <DetailRow
                    label="Active redirect URIs"
                    value={String(
                      redirects.filter((r) => r.lifecycle_status === "active").length,
                    )}
                  />
                </div>
                <div className="space-y-2 text-muted-foreground">
                  <p>
                    Activation requires a linked OAuth client ID and at least one active
                    redirect URI. The backend will reject activation if those requirements are
                    not satisfied.
                  </p>
                  <p>
                    Activation makes this client eligible for API authorization, but does not
                    independently grant access. Effective API access still requires the exact
                    active policy and user acknowledgement, applicable Tenant/Organization and
                    object scope, supported-capability authorization, ordinary user access, and
                    active runtime controls.
                  </p>
                  <p>
                    This action does not create a technical OAuth registration, credentials,
                    tokens, grants or acknowledgements.
                  </p>
                </div>
                {activateClientError && (
                  <p className="text-sm text-destructive">{activateClientError}</p>
                )}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={closeActivateClient}
                  disabled={clientLifecycleTransitionPending}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleActivateClient}
                  disabled={clientLifecycleTransitionPending}
                >
                  {activateClientPending ? "Activating…" : "Activate client"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog
            open={suspendClientOpen}
            onOpenChange={(open) => {
              if (!open) closeSuspendClient();
            }}
          >
            <DialogContent
              onEscapeKeyDown={(e) => {
                if (suspendClientPending) e.preventDefault();
              }}
              onPointerDownOutside={(e) => {
                if (suspendClientPending) e.preventDefault();
              }}
              onInteractOutside={(e) => {
                if (suspendClientPending) e.preventDefault();
              }}
            >
              <DialogHeader>
                <DialogTitle>Suspend API client</DialogTitle>
                <DialogDescription>
                  This moves the client from active to suspended.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 text-sm">
                <div className="space-y-1">
                  <DetailRow label="Display name" value={client.display_name} />
                  <DetailRow
                    label="Client key"
                    value={<span className="font-mono text-xs">{client.client_key}</span>}
                  />
                  <DetailRow
                    label="Current lifecycle status"
                    value={client.lifecycle_status}
                  />
                </div>
                <div className="space-y-2 text-muted-foreground">
                  <p>
                    Effective API authorization for this client stops immediately on the next
                    API request.
                  </p>
                  <p>
                    Existing OAuth redirect configuration, policy versions, supported
                    capabilities, acknowledgements, and Tenant/Organization or object-scope
                    records are not deleted. Those existing records cannot make a suspended
                    client usable.
                  </p>
                  <p>
                    Suspending the client does not retire it and can later be reversed through
                    an explicit reactivation. Reactivation will not grant access by itself; all
                    other policy, acknowledgement, scope, capability, user-access and runtime
                    requirements will still apply.
                  </p>
                  <p>
                    This action does not delete or revoke technical OAuth registration,
                    credentials or tokens, but runtime API authorization will reject the
                    suspended client.
                  </p>
                </div>
                {suspendClientError && (
                  <p className="text-sm text-destructive">{suspendClientError}</p>
                )}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={closeSuspendClient}
                  disabled={clientLifecycleTransitionPending}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleSuspendClient}
                  disabled={clientLifecycleTransitionPending}
                >
                  {suspendClientPending ? "Suspending…" : "Suspend client"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog
            open={reactivateClientOpen}
            onOpenChange={(open) => {
              if (!open) closeReactivateClient();
            }}
          >
            <DialogContent
              onEscapeKeyDown={(e) => {
                if (reactivateClientPending) e.preventDefault();
              }}
              onPointerDownOutside={(e) => {
                if (reactivateClientPending) e.preventDefault();
              }}
              onInteractOutside={(e) => {
                if (reactivateClientPending) e.preventDefault();
              }}
            >
              <DialogHeader>
                <DialogTitle>Reactivate API client</DialogTitle>
                <DialogDescription>
                  This moves the client from suspended to active.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 text-sm">
                <div className="space-y-1">
                  <DetailRow label="Display name" value={client.display_name} />
                  <DetailRow
                    label="Client key"
                    value={<span className="font-mono text-xs">{client.client_key}</span>}
                  />
                  <DetailRow label="Current lifecycle status" value={client.lifecycle_status} />
                  <DetailRow
                    label="OAuth client ID"
                    value={
                      client.oauth_client_id ? (
                        <span className="font-mono text-xs">{client.oauth_client_id}</span>
                      ) : (
                        <span className="text-destructive">Not linked</span>
                      )
                    }
                  />
                  <DetailRow
                    label="Active redirect URIs"
                    value={String(
                      redirects.filter((r) => r.lifecycle_status === "active").length,
                    )}
                  />
                </div>
                <div className="space-y-2 text-muted-foreground">
                  <p>
                    An active client requires a linked OAuth client ID and at least one active
                    redirect URI. The backend will reject reactivation if those requirements are
                    not satisfied.
                  </p>
                  <p>
                    Reactivation restores lifecycle eligibility for API authorization, but does
                    not independently grant access. Existing redirects, policies, capabilities,
                    acknowledgements and Tenant/Organization or object-scope records remain
                    unchanged, and become effective only when all applicable authorization
                    requirements are satisfied.
                  </p>
                  <p>
                    Effective API access still requires the exact active policy and user
                    acknowledgement, applicable scope, supported-capability authorization,
                    ordinary user access, and active runtime controls.
                  </p>
                  <p>
                    Reactivation does not create or activate redirects, policies, capabilities,
                    grants or acknowledgements, and does not create or modify technical OAuth
                    registration, credentials or tokens. It does not reconnect any user or issue
                    new tokens.
                  </p>
                </div>
                {reactivateClientError && (
                  <p className="text-sm text-destructive">{reactivateClientError}</p>
                )}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={closeReactivateClient}
                  disabled={clientLifecycleTransitionPending}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleReactivateClient}
                  disabled={clientLifecycleTransitionPending}
                >
                  {reactivateClientPending ? "Reactivating…" : "Reactivate client"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog
            open={retireClientOpen}
            onOpenChange={(open) => {
              if (retireClientPending) return;
              if (!open) closeRetireClient();
            }}
          >
            <DialogContent
              onEscapeKeyDown={(e) => {
                if (retireClientPending) e.preventDefault();
              }}
              onPointerDownOutside={(e) => {
                if (retireClientPending) e.preventDefault();
              }}
              onInteractOutside={(e) => {
                if (retireClientPending) e.preventDefault();
              }}
            >
              <DialogHeader>
                <DialogTitle>Retire API client</DialogTitle>
                <DialogDescription>
                  This permanently retires the client. Retirement is terminal.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 text-sm">
                <div className="space-y-1">
                  <DetailRow label="Display name" value={client.display_name} />
                  <DetailRow
                    label="Client key"
                    value={<span className="font-mono text-xs">{client.client_key}</span>}
                  />
                  <DetailRow label="Current lifecycle status" value={client.lifecycle_status} />
                </div>
                <div className="space-y-2 text-muted-foreground">
                  <p>
                    The client will move from {client.lifecycle_status} to retired. Retirement is
                    terminal and cannot be reversed through the administration lifecycle.
                  </p>
                  <p>
                    Effective API authorization for this client stops on the next API request.
                  </p>
                  <p>
                    Existing redirect records, policy versions, supported capabilities, policy
                    acknowledgements, Tenant/Organization enablements and Workspace, Project or
                    object-scope records are retained as historical configuration and are not
                    physically deleted. Retained configuration cannot make a retired client
                    usable, and retirement does not automatically retire or delete each child
                    configuration record.
                  </p>
                  <p>
                    Retirement does not delete or revoke the technical OAuth-provider
                    registration, credentials or already-issued tokens. BTPM runtime
                    authorization will nevertheless reject the retired client.
                  </p>
                  <p>This action does not disconnect or retire any other API client.</p>
                </div>
                {retireClientError && (
                  <p className="text-sm text-destructive">{retireClientError}</p>
                )}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={closeRetireClient}
                  disabled={clientLifecycleTransitionPending}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleRetireClient}
                  disabled={clientLifecycleTransitionPending}
                >
                  {retireClientPending ? "Retiring…" : "Retire client"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>




          <Dialog
            open={redirectOpen}

            onOpenChange={(open) => (open ? setRedirectOpen(true) : closeRedirect())}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add redirect URI</DialogTitle>
                <DialogDescription>
                  The new redirect URI will start in draft and must be activated separately.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="redirect-uri">Redirect URI</Label>
                  <Input
                    id="redirect-uri"
                    value={redirectUri}
                    maxLength={2048}
                    className="font-mono"
                    onChange={(e) => setRedirectUri(e.target.value)}
                  />
                  {redirectUri.length > 0 && !redirectValid && (
                    <p className="text-xs text-destructive">
                      Must be a non-empty https:// URI with no leading or trailing spaces, no
                      whitespace, * or # characters, and at most 2,048 characters.
                    </p>
                  )}
                </div>
                {redirectError && <p className="text-sm text-destructive">{redirectError}</p>}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeRedirect} disabled={redirectPending}>
                  Cancel
                </Button>
                <Button onClick={handleCreateRedirect} disabled={!redirectValid || redirectPending}>
                  {redirectPending ? "Adding…" : "Add redirect URI"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog
            open={editRedirectId !== null}
            onOpenChange={(open) => {
              if (!open) closeEditRedirect();
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit redirect URI</DialogTitle>
                <DialogDescription>
                  A redirect URI can only be edited while it is in draft.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-redirect-uri">Redirect URI</Label>
                  <Input
                    id="edit-redirect-uri"
                    value={editRedirectUri}
                    maxLength={2048}
                    className="font-mono"
                    onChange={(e) => setEditRedirectUri(e.target.value)}
                  />
                  {editRedirectUri.length > 0 && !editRedirectValid && (
                    <p className="text-xs text-destructive">
                      Must be a non-empty https:// URI with no leading or trailing spaces, no
                      whitespace, * or # characters, and at most 2,048 characters.
                    </p>
                  )}
                </div>
                {editRedirectError && (
                  <p className="text-sm text-destructive">{editRedirectError}</p>
                )}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={closeEditRedirect}
                  disabled={editRedirectPending}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleUpdateRedirect}
                  disabled={!editRedirectValid || editRedirectPending}
                >
                  {editRedirectPending ? "Saving…" : "Save redirect URI"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog
            open={activateRedirect !== null}
            onOpenChange={(open) => {
              if (!open && !activatePending) closeActivateRedirect();
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Activate redirect URI</DialogTitle>
                <DialogDescription>
                  Once activated, this URI becomes available for OAuth redirect use by this
                  client. It can no longer be edited as a draft.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-sm font-mono break-all rounded-md border bg-muted/40 p-3">
                  {activateRedirect?.redirect_uri}
                </p>
                {activateError && <p className="text-sm text-destructive">{activateError}</p>}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={closeActivateRedirect}
                  disabled={activatePending}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleActivateRedirect}
                  disabled={redirectTransitionPending}
                >
                  {activatePending ? "Activating…" : "Activate redirect URI"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog
            open={retireRedirect !== null}
            onOpenChange={(open) => {
              if (!open && !retirePending) closeRetireRedirect();
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Retire redirect URI</DialogTitle>
                <DialogDescription>
                  {retireRedirect?.lifecycle_status === "active"
                    ? "Retirement is permanent. This URI will stop being available for OAuth redirect use by this client."
                    : "Retirement is permanent. This draft URI will be permanently discarded and cannot later be activated."}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <p className="text-sm font-mono break-all rounded-md border bg-muted/40 p-3">
                  {retireRedirect?.redirect_uri}
                </p>
                {retireError && <p className="text-sm text-destructive">{retireError}</p>}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={closeRetireRedirect}
                  disabled={retirePending}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleRetireRedirect}
                  disabled={redirectTransitionPending}
                >
                  {retirePending ? "Retiring…" : "Retire redirect URI"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog
            open={policyOpen}
            onOpenChange={(open) => {
              if (open) return;
              if (policyPending) return;
              closePolicy();
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add policy version</DialogTitle>
                <DialogDescription>
                  The new policy version starts in draft. The server stores only a SHA-256 digest of
                  the supplied document, not the document itself.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="policy-version">Version</Label>
                  <Input
                    id="policy-version"
                    value={policyVersion}
                    maxLength={64}
                    className="font-mono"
                    onChange={(e) => setPolicyVersion(e.target.value)}
                  />
                  {policyVersion.length > 0 && !policyVersionValid && (
                    <p className="text-xs text-destructive">
                      1–64 characters, starting with a letter or digit, then only letters, digits,
                      dot, underscore or hyphen, with no spaces.
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="policy-uri">Policy URI</Label>
                  <Input
                    id="policy-uri"
                    value={policyUri}
                    className="font-mono"
                    onChange={(e) => setPolicyUri(e.target.value)}
                  />
                  {policyUri.length > 0 && !policyUriValid && (
                    <p className="text-xs text-destructive">
                      Must be a non-empty https:// URI with no leading or trailing spaces, no
                      whitespace or control characters, and at most 2,048 bytes.
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="policy-document">Policy document</Label>
                  <Textarea
                    id="policy-document"
                    value={policyDocument}
                    rows={8}
                    onChange={(e) => setPolicyDocument(e.target.value)}
                  />
                  {policyDocument.length > 0 && !policyDocumentValid && (
                    <p className="text-xs text-destructive">
                      Must not be blank and must be at most 1,048,576 bytes.
                    </p>
                  )}
                </div>
                {policyError && <p className="text-sm text-destructive">{policyError}</p>}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closePolicy} disabled={policyPending}>
                  Cancel
                </Button>
                <Button
                  onClick={handleCreatePolicyVersion}
                  disabled={!policyValid || policyPending}
                >
                  {policyPending ? "Creating…" : "Add policy version"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog
            open={editPolicyId !== null}
            onOpenChange={(open) => {
              if (open) return;
              if (editPolicyPending) return;
              closeEditPolicy();
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Edit draft policy version</DialogTitle>
                <DialogDescription>
                  BTPM stores only a SHA-256 digest of the policy document, so the existing document
                  cannot be shown. Supply the complete replacement document; the server stores only
                  its digest.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-policy-version">Version</Label>
                  <Input
                    id="edit-policy-version"
                    value={editPolicyVersion}
                    maxLength={64}
                    className="font-mono"
                    onChange={(e) => setEditPolicyVersion(e.target.value)}
                  />
                  {editPolicyVersion.length > 0 && !editPolicyVersionValid && (
                    <p className="text-xs text-destructive">
                      1–64 characters, starting with a letter or digit, then only letters, digits,
                      dot, underscore or hyphen, with no spaces.
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-policy-uri">Policy URI</Label>
                  <Input
                    id="edit-policy-uri"
                    value={editPolicyUri}
                    className="font-mono"
                    onChange={(e) => setEditPolicyUri(e.target.value)}
                  />
                  {editPolicyUri.length > 0 && !editPolicyUriValid && (
                    <p className="text-xs text-destructive">
                      Must be a non-empty https:// URI with no leading or trailing spaces, no
                      whitespace or control characters, and at most 2,048 bytes.
                    </p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-policy-document">Policy document</Label>
                  <Textarea
                    id="edit-policy-document"
                    value={editPolicyDocument}
                    rows={8}
                    onChange={(e) => setEditPolicyDocument(e.target.value)}
                  />
                  {editPolicyDocument.length > 0 && !editPolicyDocumentValid && (
                    <p className="text-xs text-destructive">
                      Must not be blank and must be at most 1,048,576 bytes.
                    </p>
                  )}
                </div>
                {editPolicyError && <p className="text-sm text-destructive">{editPolicyError}</p>}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={closeEditPolicy} disabled={editPolicyPending}>
                  Cancel
                </Button>
                <Button
                  onClick={handleUpdateDraftPolicyVersion}
                  disabled={!editPolicyValid || editPolicyPending || !editPolicyId}
                >
                  {editPolicyPending ? "Saving…" : "Save changes"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog
            open={activatePolicy !== null}
            onOpenChange={(open) => {
              if (open) return;
              if (activatePolicyPending) return;
              closeActivatePolicy();
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Activate policy version</DialogTitle>
                <DialogDescription>
                  The selected version will become this client’s active policy. If another policy
                  version is currently active, the backend will automatically supersede and retire it.
                  Any previous acknowledgement of an active policy does not acknowledge this newly
                  active version.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Version</p>
                  <p className="text-sm font-medium text-foreground">{activatePolicy?.version}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Policy URI</p>
                  <p className="text-sm font-mono break-all rounded-md border bg-muted/40 p-3">
                    {activatePolicy?.policy_uri ?? "—"}
                  </p>
                </div>
                {activatePolicyError && (
                  <p className="text-sm text-destructive">{activatePolicyError}</p>
                )}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={closeActivatePolicy}
                  disabled={activatePolicyPending}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleActivatePolicyVersion}
                  disabled={!activatePolicy?.id || activatePolicyPending || !client}
                >
                  {activatePolicyPending ? "Activating…" : "Activate policy version"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog
            open={retirePolicy !== null}
            onOpenChange={(open) => {
              if (open) return;
              if (retirePolicyPending) return;
              closeRetirePolicy();
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Retire policy version</DialogTitle>
                <DialogDescription>
                  Retirement is permanent. A retired policy version can never be edited, activated
                  or reinstated.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Version</p>
                  <p className="text-sm font-medium text-foreground">{retirePolicy?.version}</p>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Policy URI</p>
                  <p className="text-sm font-mono break-all rounded-md border bg-muted/40 p-3">
                    {retirePolicy?.policy_uri ?? "—"}
                  </p>
                </div>
                {retirePolicy?.lifecycle_status === "draft" ? (
                  <p className="text-sm text-muted-foreground">
                    This draft policy version will be permanently discarded and can never be
                    activated.
                  </p>
                ) : (
                  <div className="space-y-2 text-sm text-muted-foreground">
                    <p>
                      This policy version will immediately stop being this client’s active policy.
                    </p>
                    <p>
                      API authorization for this client may fail until another policy version is
                      activated and acknowledged.
                    </p>
                    <p>
                      To supersede an active policy without intentionally leaving the client without
                      an active policy, activate a replacement draft instead.
                    </p>
                  </div>
                )}
                {retirePolicyError && (
                  <p className="text-sm text-destructive">{retirePolicyError}</p>
                )}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={closeRetirePolicy}
                  disabled={retirePolicyPending}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleRetirePolicyVersion}
                  disabled={!retirePolicy?.id || retirePolicyPending || !client}
                >
                  {retirePolicyPending ? "Retiring…" : "Retire policy version"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog
            open={enableCapability !== null}
            onOpenChange={(open) => {
              if (open) return;
              if (enableCapabilityPending) return;
              closeEnableCapability();
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Enable capability</DialogTitle>
                <DialogDescription>
                  This client will be recorded as supporting this capability.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Capability</p>
                  <p className="text-sm font-medium text-foreground">
                    {enableCapability?.display_name}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">API version</p>
                    <p className="text-sm text-foreground">{enableCapability?.api_version}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Kind</p>
                    <p className="text-sm text-foreground">{enableCapability?.capability_kind}</p>
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Capability key</p>
                  <p className="text-sm font-mono break-all rounded-md border bg-muted/40 p-3">
                    {enableCapability?.capability_key}
                  </p>
                </div>
                {(enableCapability?.http_method || enableCapability?.route_path) && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Route</p>
                    <p className="text-sm font-mono break-all rounded-md border bg-muted/40 p-3">
                      {enableCapability?.http_method ?? "—"} {enableCapability?.route_path ?? ""}
                    </p>
                  </div>
                )}
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p>The client will be recorded as supporting this capability.</p>
                  <p>
                    If this capability was previously disabled for the client, the existing
                    supported-capability record will be re-enabled.
                  </p>
                  <p>
                    This action does not itself grant organization, workspace, project or object
                    access, and does not replace the other authorization and acknowledgement
                    requirements.
                  </p>
                </div>
                {enableCapabilityError && (
                  <p className="text-sm text-destructive">{enableCapabilityError}</p>
                )}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={closeEnableCapability}
                  disabled={enableCapabilityPending}
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleEnableCapability}
                  disabled={!enableCapability || enableCapabilityPending || !client}
                >
                  {enableCapabilityPending ? "Enabling…" : "Enable capability"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog
            open={disableCapability !== null}
            onOpenChange={(open) => {
              if (open) return;
              if (disableCapabilityPending) return;
              closeDisableCapability();
            }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Disable capability</DialogTitle>
                <DialogDescription>
                  This client will no longer be authorized to use API operations that require this
                  capability.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Capability</p>
                  <p className="text-sm font-medium text-foreground">
                    {disableCapability?.display_name}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">API version</p>
                    <p className="text-sm text-foreground">{disableCapability?.api_version}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Kind</p>
                    <p className="text-sm text-foreground">{disableCapability?.capability_kind}</p>
                  </div>
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Capability key</p>
                  <p className="text-sm font-mono break-all rounded-md border bg-muted/40 p-3">
                    {disableCapability?.capability_key}
                  </p>
                </div>
                {(disableCapability?.http_method || disableCapability?.route_path) && (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">Route</p>
                    <p className="text-sm font-mono break-all rounded-md border bg-muted/40 p-3">
                      {disableCapability?.http_method ?? "—"} {disableCapability?.route_path ?? ""}
                    </p>
                  </div>
                )}
                <div className="space-y-2 text-sm text-muted-foreground">
                  <p>
                    The supported-capability record will be disabled, not deleted.
                  </p>
                  <p>
                    The client will no longer be authorized to use API operations that require this
                    capability.
                  </p>
                  <p>
                    Existing organization, workspace, project or object grants are not deleted, but
                    they cannot make this disabled capability usable.
                  </p>
                  <p>
                    The capability can later be re-enabled, but all other authorization and
                    policy-acknowledgement requirements will still apply.
                  </p>
                </div>
                {disableCapabilityError && (
                  <p className="text-sm text-destructive">{disableCapabilityError}</p>
                )}
              </div>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={closeDisableCapability}
                  disabled={disableCapabilityPending}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDisableCapability}
                  disabled={!disableCapability || disableCapabilityPending || !client}
                >
                  {disableCapabilityPending ? "Disabling…" : "Disable capability"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>


      )}
    </SaasAdminShell>
  );
}
