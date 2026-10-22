import type { ProjectBrief } from "@t3tools/contracts";

import type { EnvironmentProject } from "./models.ts";

type FocusProject = Pick<EnvironmentProject, "title" | "workspaceRoot">;

/** A folder a briefed project works in, named after the T3 project that owns it when there is one. */
export interface ProjectFocus<Project extends FocusProject = EnvironmentProject> {
  readonly name: string;
  readonly path: string;
  readonly project: Project | null;
}

const normalizedPath = (path: string) => path.replace(/[\\/]+$/, "").toLowerCase();

const folderName = (path: string) => {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1) || path;
};

/**
 * A briefed project spans folders that are often projects of their own; the
 * coordinator's chats all run in the brief's folder, so its name says little
 * about what a chat works on. These are the folders a chat can be about.
 */
export function projectFocusCandidates<Project extends FocusProject>(
  brief: Pick<ProjectBrief, "context">,
  projects: ReadonlyArray<Project>,
): ReadonlyArray<ProjectFocus<Project>> {
  return brief.context.flatMap((entry): ReadonlyArray<ProjectFocus<Project>> => {
    if (entry.kind !== "directory") return [];
    const path = normalizedPath(entry.path);
    const project =
      projects.find((candidate) => normalizedPath(candidate.workspaceRoot) === path) ?? null;
    return [{ name: project?.title ?? folderName(entry.path), path: entry.path, project }];
  });
}

const isWordCharacter = (character: string | undefined) =>
  character !== undefined && /[\p{L}\p{N}]/u.test(character);

/** The folder a chat's title names first, as in "Moat (Lockspace) iOS". */
export function resolveThreadFocus<Focus extends Pick<ProjectFocus, "name">>(
  title: string,
  candidates: ReadonlyArray<Focus>,
): Focus | null {
  const haystack = title.toLowerCase();
  let best: { readonly focus: Focus; readonly index: number } | null = null;
  for (const focus of candidates) {
    const needle = focus.name.toLowerCase();
    if (needle === "") continue;
    for (
      let index = haystack.indexOf(needle);
      index !== -1;
      index = haystack.indexOf(needle, index + 1)
    ) {
      if (
        isWordCharacter(haystack[index - 1]) ||
        isWordCharacter(haystack[index + needle.length])
      ) {
        continue;
      }
      if (best === null || index < best.index) best = { focus, index };
      break;
    }
  }
  return best?.focus ?? null;
}
