import {
  MessageId,
  ProviderThreadId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2TurnItem,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  COORDINATOR_DEFAULT_CACHE_TTL_MS,
  coordinatorCacheExpired,
  coordinatorRecapItems,
} from "./coordinatorFreshSession.ts";

const providerThreadId = ProviderThreadId.make("provider-thread:coordinator");
const minute = 60_000;
const lastRequest = Date.parse("2026-10-22T10:00:00.000Z");

const turn = (updatedAt: number, promptCacheTtlMs?: number) => ({
  providerThreadId,
  completedAt: null,
  tokenUsage: {
    usedTokens: 1,
    updatedAt: DateTime.formatIso(DateTime.makeUnsafe(updatedAt)),
    ...(promptCacheTtlMs === undefined ? {} : { promptCacheTtlMs }),
  },
});

describe("coordinatorCacheExpired", () => {
  it("follows the cache lifetime the provider reported", () => {
    const turns = [turn(lastRequest - 30 * minute, 5 * minute), turn(lastRequest)];
    expect(
      coordinatorCacheExpired({
        providerTurns: turns,
        providerThreadId,
        now: lastRequest + 4 * minute,
      }),
    ).toBe(false);
    expect(
      coordinatorCacheExpired({
        providerTurns: turns,
        providerThreadId,
        now: lastRequest + 6 * minute,
      }),
    ).toBe(true);
  });

  it("assumes an hour when the provider reports no lifetime, and never expires without requests", () => {
    const turns = [turn(lastRequest)];
    expect(
      coordinatorCacheExpired({
        providerTurns: turns,
        providerThreadId,
        now: lastRequest + COORDINATOR_DEFAULT_CACHE_TTL_MS,
      }),
    ).toBe(false);
    expect(
      coordinatorCacheExpired({
        providerTurns: turns,
        providerThreadId,
        now: lastRequest + COORDINATOR_DEFAULT_CACHE_TTL_MS + minute,
      }),
    ).toBe(true);
    expect(coordinatorCacheExpired({ providerTurns: [], providerThreadId, now: lastRequest })).toBe(
      false,
    );
  });
});

function item(id: string, runId: string, type: "user" | "assistant"): OrchestrationV2TurnItem {
  const at = DateTime.makeUnsafe("2026-10-22T09:00:00.000Z");
  const base = {
    id: TurnItemId.make(`turn-item:${id}`),
    threadId: ThreadId.make("project-coordinator:one"),
    runId: RunId.make(runId),
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 1,
    status: "completed" as const,
    title: null,
    startedAt: at,
    completedAt: at,
    updatedAt: at,
    messageId: MessageId.make(`message:${id}`),
    text: id,
  };
  return type === "user"
    ? {
        ...base,
        createdBy: "user",
        creationSource: "server",
        type: "user_message",
        inputIntent: "turn_start",
        attachments: [],
      }
    : { ...base, type: "assistant_message", streaming: false };
}

describe("coordinatorRecapItems", () => {
  it("keeps the briefing and the one exchange before this run", () => {
    const started = DateTime.makeUnsafe("2026-10-22T09:00:00.000Z");
    const runs = [1, 2, 3, 4].map((ordinal) => ({
      id: RunId.make(`run-${ordinal}`),
      ordinal,
      startedAt: started,
    }));
    const items = [
      item("briefing", "run-1", "user"),
      item("plan", "run-1", "assistant"),
      item("old-question", "run-2", "user"),
      item("old-answer", "run-2", "assistant"),
      item("last-question", "run-3", "user"),
      item("last-answer", "run-3", "assistant"),
    ];
    expect(
      coordinatorRecapItems({ items, runs, targetOrdinal: 4 }).map((entry) => entry.id),
    ).toEqual([
      TurnItemId.make("turn-item:briefing"),
      TurnItemId.make("turn-item:last-question"),
      TurnItemId.make("turn-item:last-answer"),
    ]);
  });
});
