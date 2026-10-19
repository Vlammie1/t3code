import type {
  EnvironmentProject,
  EnvironmentThreadShell,
} from "@t3tools/client-runtime/state/shell";
import type { ProjectBrief, ThreadId } from "@t3tools/contracts";

import { resolveThreadStatusPill, type ThreadStatusPill } from "../Sidebar.logic";

export type ProjectSort = "activity" | "name" | "created";

export const PROJECT_SORT_LABELS: Record<ProjectSort, string> = {
  activity: "Recent activity",
  name: "Name",
  created: "Created",
};

type ProjectThread = Pick<
  EnvironmentThreadShell,
  | "id"
  | "deletedAt"
  | "archivedAt"
  | "lineage"
  | "latestRun"
  | "latestUserMessageAt"
  | "createdAt"
  | "hasActionableProposedPlan"
  | "hasPendingApprovals"
  | "hasPendingUserInput"
  | "pendingSubagentRequest"
  | "interactionMode"
  | "runtime"
  | "lastVisitedAt"
  | "pendingBackgroundTasks"
>;

export interface ProjectThreads<Thread extends ProjectThread = EnvironmentThreadShell> {
  readonly coordinator: Thread | null;
  /** The project's other chats, most recently active first. */
  readonly chats: ReadonlyArray<Thread>;
  readonly lastActivityAt: string | null;
  readonly workingCount: number;
  readonly needsYouCount: number;
  /** What a project card shows: anything waiting on the user first, then running work. */
  readonly headline: {
    readonly label: string;
    readonly colorClass: string;
    readonly dotClass: string;
  } | null;
}

const activityAt = (thread: ProjectThread) =>
  thread.latestRun?.completedAt ??
  thread.latestRun?.requestedAt ??
  thread.latestUserMessageAt ??
  thread.createdAt;

const newestFirst = (left: string, right: string) => (left < right ? 1 : left > right ? -1 : 0);

/**
 * Subagents belong to the thread that delegated them, so they show there and
 * not as project chats of their own.
 */
export function collectProjectThreads<Thread extends ProjectThread>(
  threads: ReadonlyArray<Thread>,
  coordinatorThreadId: ThreadId | null,
): ProjectThreads<Thread> {
  let coordinator: Thread | null = null;
  const chats: Array<Thread> = [];
  let workingCount = 0;
  let needsYouCount = 0;
  let lastActivityAt: string | null = null;
  let needsYouPill: ThreadStatusPill | null = null;
  let workingPill: ThreadStatusPill | null = null;
  for (const thread of threads) {
    if (thread.deletedAt !== null || thread.archivedAt !== null) continue;
    if (thread.lineage.relationshipToParent === "subagent") continue;
    const at = activityAt(thread);
    if (lastActivityAt === null || at > lastActivityAt) lastActivityAt = at;
    const status = resolveThreadStatusPill({ thread });
    if (status?.label === "Working") {
      workingCount += 1;
      workingPill ??= status;
    }
    if (status?.label === "Pending Approval" || status?.label === "Awaiting Input") {
      needsYouCount += 1;
      needsYouPill ??= status;
    }
    if (thread.id === coordinatorThreadId) coordinator = thread;
    else chats.push(thread);
  }
  chats.sort((left, right) => newestFirst(activityAt(left), activityAt(right)));
  const headline =
    needsYouPill !== null
      ? { ...needsYouPill, label: needsYouCount === 1 ? "Needs you" : `${needsYouCount} need you` }
      : workingPill !== null
        ? { ...workingPill, label: `${workingCount} working` }
        : null;
  return { coordinator, chats, lastActivityAt, workingCount, needsYouCount, headline };
}

type SortableProject = {
  readonly project: Pick<EnvironmentProject, "title" | "createdAt">;
  readonly brief: Pick<ProjectBrief, "goal">;
};

export function filterAndSortProjects<Item extends SortableProject>(
  projects: ReadonlyArray<Item>,
  input: {
    readonly query: string;
    readonly sort: ProjectSort;
    readonly lastActivityAt: (project: Item) => string | null;
  },
): ReadonlyArray<Item> {
  const query = input.query.trim().toLowerCase();
  const matching =
    query === ""
      ? [...projects]
      : projects.filter(
          ({ project, brief }) =>
            project.title.toLowerCase().includes(query) || brief.goal.toLowerCase().includes(query),
        );
  const byName = (left: Item, right: Item) =>
    left.project.title.localeCompare(right.project.title, undefined, { sensitivity: "base" });
  return matching.sort((left, right) => {
    if (input.sort === "name") return byName(left, right);
    const leftAt =
      input.sort === "created"
        ? left.project.createdAt
        : (input.lastActivityAt(left) ?? left.project.createdAt);
    const rightAt =
      input.sort === "created"
        ? right.project.createdAt
        : (input.lastActivityAt(right) ?? right.project.createdAt);
    return newestFirst(leftAt, rightAt) || byName(left, right);
  });
}

/** Paths arrive pasted, dropped or picked, so blanks and repeats are expected. */
export function mergeContextPaths(
  current: ReadonlyArray<string>,
  added: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const next = [...current];
  for (const raw of added) {
    const path = raw.trim().replace(/^["']|["']$/g, "");
    if (path !== "" && !next.includes(path)) next.push(path);
  }
  return next;
}

export function pathBaseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1) || path;
}
