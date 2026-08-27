import { useOutletContext } from "react-router-dom";
import WorkspaceProjects from "./WorkspaceProjects";
import WorkspacePrograms from "./WorkspacePrograms";
import WorkspaceTemplates from "./WorkspaceTemplates";
import WorkspaceMembers from "./WorkspaceMembers";
import WorkspaceSharepoint from "./WorkspaceSharepoint";
import WorkspacePeoplePresets from "./WorkspacePeoplePresets";

type Ctx = { workspaceId: string };

export function ProjectsTabProjects() {
  const { workspaceId } = useOutletContext<Ctx>();
  return <WorkspaceProjects workspaceId={workspaceId} />;
}
export function ProjectsTabPrograms() {
  const { workspaceId } = useOutletContext<Ctx>();
  return <WorkspacePrograms workspaceId={workspaceId} />;
}
export function ProjectsTabTemplates() {
  const { workspaceId } = useOutletContext<Ctx>();
  return <WorkspaceTemplates workspaceId={workspaceId} />;
}
export function ProjectsTabMembers() {
  const { workspaceId } = useOutletContext<Ctx>();
  return <WorkspaceMembers workspaceId={workspaceId} />;
}
export function ProjectsTabSharepoint() {
  const { workspaceId } = useOutletContext<Ctx>();
  return <WorkspaceSharepoint workspaceId={workspaceId} />;
}
export function ProjectsTabPeoplePresets() {
  const { workspaceId } = useOutletContext<Ctx>();
  return <WorkspacePeoplePresets workspaceId={workspaceId} />;
}
