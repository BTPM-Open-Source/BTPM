import { useParams } from "react-router-dom";
import { ProjectCalendarView } from "@/components/calendar/ProjectCalendarView";

export default function ProjectCalendar() {
  const { workspaceId, projectId } = useParams<{ workspaceId: string; projectId: string }>();
  if (!projectId || !workspaceId) return null;
  const basePath = `/workspace/${workspaceId}/project/${projectId}`;
  return <ProjectCalendarView projectId={projectId} workspaceId={workspaceId} basePath={basePath} />;
}
