import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentId, ProjectBrief, ProjectId } from "@t3tools/contracts";
import { Atom } from "effect/reactivity";

import { serverEnvironment } from "./server";

type BriefsByEnvironment = ReadonlyMap<EnvironmentId, Readonly<Record<ProjectId, ProjectBrief>>>;

// Keyed by the sorted environment ids, so one set of environments resolves to one atom.
const projectBriefsAtom = Atom.family((key: string) => {
  const environmentIds = JSON.parse(key) as ReadonlyArray<EnvironmentId>;
  return Atom.make(
    (get): BriefsByEnvironment =>
      new Map(
        environmentIds.map((environmentId) => [
          environmentId,
          get(serverEnvironment.settingsValueAtom(environmentId))?.projectBriefs ?? {},
        ]),
      ),
  ).pipe(Atom.withLabel("mobile-project-briefs"));
});

export function useProjectBriefsByEnvironment(
  environmentIds: ReadonlyArray<EnvironmentId>,
): BriefsByEnvironment {
  return useAtomValue(projectBriefsAtom(JSON.stringify([...new Set(environmentIds)].toSorted())));
}
