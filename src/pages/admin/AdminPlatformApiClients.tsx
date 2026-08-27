import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, keepPreviousData, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
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
import { SaasAdminShell, AdminLoadingCards, AdminEmptyState } from "./SaasAdminShell";

const PAGE_SIZE = 25;

interface ApiClientRow {
  id: string;
  client_key: string;
  display_name: string;
  description: string | null;
  oauth_client_id: string | null;
  lifecycle_status: string;
  created_at: string;
  updated_at: string;
  redirect_count: number;
  active_redirect_count: number;
  policy_version_count: number;
  active_policy_version: string | null;
  enabled_supported_capability_count: number;
  total_count: number;
}

function statusVariant(status: string): "default" | "secondary" | "outline" {
  if (status === "active") return "default";
  if (status === "retired") return "outline";
  return "secondary";
}

export default function AdminPlatformApiClients() {
  const [includeRetired, setIncludeRetired] = useState(false);
  const [page, setPage] = useState(0);
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [createOpen, setCreateOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [clientKey, setClientKey] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [description, setDescription] = useState("");
  const [oauthClientId, setOauthClientId] = useState("");

  const resetForm = () => {
    setClientKey("");
    setDisplayName("");
    setDescription("");
    setOauthClientId("");
    setFormError(null);
  };

  const isValidLower = (value: string) =>
    value.length > 0 && value === value.trim() && value === value.toLowerCase();

  const canSubmit =
    !submitting &&
    isValidLower(clientKey) &&
    displayName.trim().length > 0 &&
    (oauthClientId.length === 0 || isValidLower(oauthClientId));

  const handleCreate = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const { data, error } = await (supabase.rpc as any)("api_g_5_5_platform_create_client", {
        _client_key: clientKey,
        _display_name: displayName.trim(),
        _description: description.trim() ? description.trim() : null,
        _oauth_client_id: oauthClientId ? oauthClientId : null,
      });
      if (error) throw error;
      const newId = Array.isArray(data) ? data[0] : data;
      await queryClient.invalidateQueries({ queryKey: ["platform-admin-api-clients"] });
      setCreateOpen(false);
      resetForm();
      if (newId) navigate(`/admin/platform/api-clients/${newId}`);
    } catch {
      setFormError("Could not create the API client. Check the details and try again.");
    } finally {
      setSubmitting(false);
    }
  };


  const { data, isLoading, error } = useQuery({
    queryKey: ["platform-admin-api-clients", includeRetired, page],
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("api_g_5_6_platform_list_clients", {
        _include_retired: includeRetired,
        _limit: PAGE_SIZE,
        _offset: page * PAGE_SIZE,
      });
      if (error) throw error;
      return (data ?? []) as ApiClientRow[];
    },
    staleTime: 30_000,
    placeholderData: keepPreviousData,
  });

  const rows = data ?? [];
  const totalCount = rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;
  const rangeStart = totalCount === 0 ? 0 : page * PAGE_SIZE + 1;
  const rangeEnd = page * PAGE_SIZE + rows.length;
  const canPrev = page > 0;
  const canNext = rangeEnd < totalCount;

  return (
    <SaasAdminShell
      title="API clients"
      scope="platform"
      crumbs={[{ label: "Platform", to: "/admin/platform" }, { label: "API clients" }]}
    >
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-base">Registered API clients</CardTitle>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Switch
                  id="show-retired"
                  checked={includeRetired}
                  onCheckedChange={(checked) => {
                    setIncludeRetired(checked);
                    setPage(0);
                  }}
                />
                <Label htmlFor="show-retired" className="text-xs font-normal text-muted-foreground">
                  Show retired
                </Label>
              </div>
              <Button
                size="sm"
                onClick={() => {
                  resetForm();
                  setCreateOpen(true);
                }}
              >
                Create API client
              </Button>
            </div>

          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && (
            <div className="p-4">
              <AdminLoadingCards count={3} />
            </div>
          )}
          {error && (
            <div className="py-6 px-4 text-sm text-destructive">Failed to load API clients.</div>
          )}
          {!isLoading && !error && rows.length === 0 && (
            <div className="p-4">
              <AdminEmptyState
                title="No API clients found"
                description="No API clients are registered for the current filter."
              />
            </div>
          )}
          {!error && rows.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Redirects</TableHead>
                  <TableHead>Active policy version</TableHead>
                  <TableHead>Enabled capabilities</TableHead>
                  <TableHead>Last updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link
                        to={`/admin/platform/api-clients/${row.id}`}
                        className="text-sm font-medium text-foreground hover:underline"
                      >
                        {row.display_name}
                      </Link>
                      <p className="text-xs text-muted-foreground font-mono">{row.client_key}</p>
                    </TableCell>
                    <TableCell>
                      <Badge variant={statusVariant(row.lifecycle_status)} className="font-normal">
                        {row.lifecycle_status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {Number(row.active_redirect_count ?? 0)} active / {Number(row.redirect_count ?? 0)} total
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {row.active_policy_version ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {Number(row.enabled_supported_capability_count ?? 0)}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(row.updated_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {!error && rows.length > 0 && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-muted-foreground">
            Showing {rangeStart}–{rangeEnd} of {totalCount}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!canPrev}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!canNext}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          if (submitting) return;
          setCreateOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create API client</DialogTitle>
            <DialogDescription>
              The client is created in draft. Lifecycle, redirects, policies and capabilities are
              managed after creation.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="client-key" className="text-xs">
                Client key
              </Label>
              <Input
                id="client-key"
                value={clientKey}
                onChange={(e) => setClientKey(e.target.value)}
                placeholder="astra-connect"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Lowercase, no leading or trailing spaces.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="display-name" className="text-xs">
                Display name
              </Label>
              <Input
                id="display-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Astra Connect"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client-description" className="text-xs">
                Description <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Textarea
                id="client-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="oauth-client-id" className="text-xs">
                OAuth client ID <span className="text-muted-foreground">(optional)</span>
              </Label>
              <Input
                id="oauth-client-id"
                value={oauthClientId}
                onChange={(e) => setOauthClientId(e.target.value)}
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Lowercase, no leading or trailing spaces.
              </p>
            </div>
            {formError && <p className="text-sm text-destructive">{formError}</p>}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setCreateOpen(false);
                resetForm();
              }}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={!canSubmit}>
              {submitting ? "Creating…" : "Create client"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SaasAdminShell>

  );
}
