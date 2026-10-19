import type { EnvironmentId, ProjectId } from "@t3tools/contracts";
import { createFileRoute, redirect } from "@tanstack/react-router";

import { ProjectHubPage } from "../components/projects/ProjectHubPage";

export const Route = createFileRoute("/projects/$environmentId/$projectId")({
  beforeLoad: async ({ context }) => {
    if (
      context.authGateState.status !== "authenticated" &&
      context.authGateState.status !== "hosted-static"
    ) {
      throw redirect({ to: "/pair", replace: true });
    }
  },
  component: ProjectHubRoute,
});

function ProjectHubRoute() {
  const { environmentId, projectId } = Route.useParams();
  return (
    <ProjectHubPage
      key={`${environmentId}:${projectId}`}
      environmentId={environmentId as EnvironmentId}
      projectId={projectId as ProjectId}
    />
  );
}
