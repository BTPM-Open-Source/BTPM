import { useEffect } from "react";
import { Navigate, useParams } from "react-router-dom";
import { useActiveWorkspace } from "@/context/ActiveWorkspaceContext";

/**
 * UX-FIX — Legacy workspace tab route shim.
 *
 * `/workspace/:workspaceId[/tab]` no longer renders its own shell. It adopts
 * the workspace as the active scope and redirects to the canonical
 * `/projects[/tab]` module so there is exactly one Projects experience.
 *
 * Project-detail and program-detail routes are intentionally NOT touched.
 */
export default function LegacyWorkspaceTabRedirect({ tab }: { tab?: string }) {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const { adoptActiveWorkspaceId } = useActiveWorkspace();

  useEffect(() => {
    if (workspaceId) adoptActiveWorkspaceId(workspaceId);
  }, [workspaceId, adoptActiveWorkspaceId]);

  const target = tab ? `/projects/${tab}` : "/projects";
  return <Navigate to={target} replace />;
}
