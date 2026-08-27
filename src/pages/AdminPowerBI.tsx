/**
 * Admin → Power BI reporting scope page.
 *
 * Scope-only surface. Organization admins control which Workspaces are
 * exposed to Power BI through the governed reporting views. Direct reporting
 * credentials and readiness are managed by the Tenant Admin.
 */

import { useOutletContext } from "react-router-dom";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Database } from "lucide-react";
import PowerBiDataScopePanel from "@/components/admin/PowerBiDataScopePanel";

interface OutletCtx {
  organizationId: string;
}

export default function AdminPowerBI() {
  const { organizationId } = useOutletContext<OutletCtx>();

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-xl font-semibold text-foreground">
          Power BI reporting scope
        </h2>
        <p className="text-sm text-muted-foreground">
          Control which BTPM Workspaces are exposed through the governed Power BI
          reporting views. All Projects in an included Workspace are reportable.
        </p>
      </div>

      <Alert>
        <Database className="h-4 w-4" />
        <AlertTitle>Power BI Direct reporting</AlertTitle>
        <AlertDescription>
          Power BI uses a PostgreSQL Import connection to BTPM reporting views.
          Reporting credentials and readiness are managed under Tenant Admin →
          Integrations.
        </AlertDescription>
      </Alert>

      <PowerBiDataScopePanel organizationId={organizationId} />
    </div>
  );
}
