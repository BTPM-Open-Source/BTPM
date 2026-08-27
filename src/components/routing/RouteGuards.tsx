import { useParams } from "react-router-dom";
import { RouteContextBoundaryGuard } from "./RouteContextBoundaryGuard";
import { ReactNode } from "react";

/**
 * Phase 4D.8 — Adapters that translate URL params into a boundary check.
 *
 * Each adapter reads the params for its route pattern and delegates to the
 * central RouteContextBoundaryGuard.
 */

export function WorkspaceRouteGuard({ children }: { children: ReactNode }) {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  return (
    <RouteContextBoundaryGuard workspaceId={workspaceId ?? null}>
      {children}
    </RouteContextBoundaryGuard>
  );
}

export function ProgramRouteGuard({ children }: { children: ReactNode }) {
  const { workspaceId, programId } = useParams<{ workspaceId: string; programId: string }>();
  return (
    <RouteContextBoundaryGuard workspaceId={workspaceId ?? null} programId={programId ?? null}>
      {children}
    </RouteContextBoundaryGuard>
  );
}

export function ProjectRouteGuard({ children }: { children: ReactNode }) {
  const { workspaceId, projectId } = useParams<{ workspaceId: string; projectId: string }>();
  return (
    <RouteContextBoundaryGuard workspaceId={workspaceId ?? null} projectId={projectId ?? null}>
      {children}
    </RouteContextBoundaryGuard>
  );
}

export function PhaseRouteGuard({ children }: { children: ReactNode }) {
  const { workspaceId, projectId, phaseId } = useParams<{
    workspaceId: string;
    projectId: string;
    phaseId: string;
  }>();
  return (
    <RouteContextBoundaryGuard
      workspaceId={workspaceId ?? null}
      projectId={projectId ?? null}
      phaseId={phaseId ?? null}
    >
      {children}
    </RouteContextBoundaryGuard>
  );
}

export function TaskRouteGuard({ children }: { children: ReactNode }) {
  const { workspaceId, projectId, taskId } = useParams<{
    workspaceId: string;
    projectId: string;
    taskId: string;
  }>();
  return (
    <RouteContextBoundaryGuard
      workspaceId={workspaceId ?? null}
      projectId={projectId ?? null}
      taskId={taskId ?? null}
    >
      {children}
    </RouteContextBoundaryGuard>
  );
}
