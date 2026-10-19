import { ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  collectProjectThreads,
  filterAndSortProjects,
  mergeContextPaths,
  pathBaseName,
} from "./projects.logic";

const coordinatorId = ThreadId.make("coordinator");

function thread(
  id: string,
  overrides: Partial<Parameters<typeof collectProjectThreads>[0][number]> = {},
) {
  return {
    id: ThreadId.make(id),
    deletedAt: null,
    archivedAt: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: ThreadId.make(id) },
    latestRun: null,
    latestUserMessageAt: null,
    createdAt: "2026-10-01T09:00:00.000Z",
    hasActionableProposedPlan: false,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    pendingSubagentRequest: null,
    interactionMode: "default" as const,
    runtime: null,
    lastVisitedAt: null,
    pendingBackgroundTasks: [],
    ...overrides,
  };
}

const running = {
  status: "running" as const,
  providerName: "Claude",
  providerInstanceId: ProviderInstanceId.make("claudeAgent"),
  activeRunId: null,
  lastError: null,
  updatedAt: "2026-10-19T10:00:00.000Z",
};

describe("collectProjectThreads", () => {
  it("sets the coordinator apart and lists the other chats newest first", () => {
    const result = collectProjectThreads(
      [
        thread("old", { createdAt: "2026-10-01T09:00:00.000Z" }),
        thread("coordinator", { createdAt: "2026-10-02T09:00:00.000Z" }),
        thread("new", { latestUserMessageAt: "2026-10-18T09:00:00.000Z" }),
      ],
      coordinatorId,
    );
    expect(result.coordinator?.id).toBe(coordinatorId);
    expect(result.chats.map((chat) => chat.id)).toEqual(["new", "old"]);
    expect(result.lastActivityAt).toBe("2026-10-18T09:00:00.000Z");
  });

  it("leaves out archived threads and subagents", () => {
    const result = collectProjectThreads(
      [
        thread("archived", { archivedAt: "2026-10-03T09:00:00.000Z" }),
        thread("subagent", {
          lineage: {
            parentThreadId: coordinatorId,
            relationshipToParent: "subagent",
            rootThreadId: coordinatorId,
          },
        }),
        thread("kept"),
      ],
      coordinatorId,
    );
    expect(result.coordinator).toBeNull();
    expect(result.chats.map((chat) => chat.id)).toEqual(["kept"]);
  });

  it("puts a chat that waits on the user ahead of running work in the headline", () => {
    const working = collectProjectThreads(
      [thread("a", { runtime: running }), thread("b", { runtime: running })],
      coordinatorId,
    );
    expect(working.headline?.label).toBe("2 working");

    const waiting = collectProjectThreads(
      [thread("a", { runtime: running }), thread("b", { hasPendingApprovals: true })],
      coordinatorId,
    );
    expect(waiting.headline?.label).toBe("Needs you");
    expect(waiting.workingCount).toBe(1);

    expect(collectProjectThreads([thread("idle")], coordinatorId).headline).toBeNull();
  });
});

describe("filterAndSortProjects", () => {
  const projects = [
    { project: { title: "Vakantie", createdAt: "2026-10-01T00:00:00.000Z" }, brief: { goal: "" } },
    {
      project: { title: "API performance", createdAt: "2026-10-05T00:00:00.000Z" },
      brief: { goal: "Bring p95 latency under 200 ms" },
    },
    { project: { title: "greatness", createdAt: "2026-10-03T00:00:00.000Z" }, brief: { goal: "" } },
  ];
  const activity: Record<string, string | null> = {
    Vakantie: "2026-10-19T00:00:00.000Z",
    "API performance": null,
    greatness: "2026-10-10T00:00:00.000Z",
  };
  const titles = (input: Parameters<typeof filterAndSortProjects>[1]) =>
    filterAndSortProjects(projects, input).map((item) => item.project.title);
  const lastActivityAt = (item: (typeof projects)[number]) => activity[item.project.title] ?? null;

  it("sorts by activity, falling back to creation for a project without chats", () => {
    expect(titles({ query: "", sort: "activity", lastActivityAt })).toEqual([
      "Vakantie",
      "greatness",
      "API performance",
    ]);
  });

  it("sorts by name without regard to case, and by creation date", () => {
    expect(titles({ query: "", sort: "name", lastActivityAt })).toEqual([
      "API performance",
      "greatness",
      "Vakantie",
    ]);
    expect(titles({ query: "", sort: "created", lastActivityAt })).toEqual([
      "API performance",
      "greatness",
      "Vakantie",
    ]);
  });

  it("matches the query against the name and the goal", () => {
    expect(titles({ query: "latency", sort: "name", lastActivityAt })).toEqual(["API performance"]);
    expect(titles({ query: "VAK", sort: "name", lastActivityAt })).toEqual(["Vakantie"]);
  });
});

describe("mergeContextPaths", () => {
  it("drops blanks, quotes and repeats", () => {
    expect(
      mergeContextPaths(["C:\\repos\\api"], ['"C:\\repos\\api"', " ", "C:\\notes.md "]),
    ).toEqual(["C:\\repos\\api", "C:\\notes.md"]);
  });
});

describe("pathBaseName", () => {
  it("reads the last segment of Windows and POSIX paths", () => {
    expect(pathBaseName("C:\\Users\\dan\\repos\\api\\")).toBe("api");
    expect(pathBaseName("/home/dan/notes.md")).toBe("notes.md");
  });
});
