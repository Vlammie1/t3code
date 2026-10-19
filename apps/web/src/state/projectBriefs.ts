import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ProjectBrief, ProjectId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { environmentProjects } from "./projects";
import { serverEnvironment } from "./server";

export interface BriefedProject {
  readonly project: EnvironmentProject;
  readonly brief: ProjectBrief;
}

const briefedProjectsAtom = Atom.make((get): ReadonlyArray<BriefedProject> => {
  const projects = get(environmentProjects.projectsAtom);
  const briefsByEnvironment = new Map<EnvironmentId, Readonly<Record<ProjectId, ProjectBrief>>>();
  return projects.flatMap((project) => {
    let briefs = briefsByEnvironment.get(project.environmentId);
    if (briefs === undefined) {
      briefs = get(serverEnvironment.settingsValueAtom(project.environmentId))?.projectBriefs ?? {};
      briefsByEnvironment.set(project.environmentId, briefs);
    }
    const brief = briefs[project.id];
    return brief === undefined ? [] : [{ project, brief }];
  });
}).pipe(Atom.withLabel("web-briefed-projects"));

const EMPTY_BRIEF_ATOM = Atom.make<ProjectBrief | null>(null).pipe(
  Atom.withLabel("web-project-brief:empty"),
);

// Keyed by string so one project resolves to one atom however its ref was built.
const projectBriefAtom = Atom.family((key: string) => {
  const [environmentId, projectId] = JSON.parse(key) as [EnvironmentId, ProjectId];
  return Atom.make(
    (get): ProjectBrief | null =>
      get(serverEnvironment.settingsValueAtom(environmentId))?.projectBriefs[projectId] ?? null,
  ).pipe(Atom.withLabel("web-project-brief"));
});

export function useBriefedProjects(): ReadonlyArray<BriefedProject> {
  return useAtomValue(briefedProjectsAtom);
}

export function useProjectBrief(
  project: Pick<EnvironmentProject, "environmentId" | "id"> | null,
): ProjectBrief | null {
  return useAtomValue(
    project === null
      ? EMPTY_BRIEF_ATOM
      : projectBriefAtom(JSON.stringify([project.environmentId, project.id])),
  );
}
