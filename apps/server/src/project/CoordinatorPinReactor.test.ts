import { ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import {
  COORDINATOR_PIN_THREAD_COUNT,
  type CountedThread,
  shouldPinCoordinator,
} from "./CoordinatorPinReactor.ts";

const at = DateTime.makeUnsafe("2026-10-22T10:00:00.000Z");

const thread = (id: string, overrides: Partial<CountedThread> = {}): CountedThread => ({
  id: ThreadId.make(id),
  deletedAt: null,
  archivedAt: null,
  pinnedAt: null,
  lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: ThreadId.make(id) },
  ...overrides,
});

const chats = (count: number) =>
  Array.from({ length: count }, (_, index) => thread(`chat-${index}`));

describe("shouldPinCoordinator", () => {
  it("pins once the project reaches the threshold, the coordinator included", () => {
    const coordinator = thread("coordinator");
    expect(
      shouldPinCoordinator({
        threads: [coordinator, ...chats(COORDINATOR_PIN_THREAD_COUNT - 2)],
        coordinatorThreadId: "coordinator",
      }),
    ).toBe(false);
    expect(
      shouldPinCoordinator({
        threads: [coordinator, ...chats(COORDINATOR_PIN_THREAD_COUNT - 1)],
        coordinatorThreadId: "coordinator",
      }),
    ).toBe(true);
  });

  it("does not count subagents or removed threads, and leaves a pinned coordinator alone", () => {
    const removed = [
      thread("sub", {
        lineage: {
          parentThreadId: ThreadId.make("chat-0"),
          relationshipToParent: "subagent",
          rootThreadId: ThreadId.make("chat-0"),
        },
      }),
      thread("gone", { deletedAt: at }),
    ];
    expect(
      shouldPinCoordinator({
        threads: [thread("coordinator"), ...chats(3), ...removed],
        coordinatorThreadId: "coordinator",
      }),
    ).toBe(false);
    expect(
      shouldPinCoordinator({
        threads: [thread("coordinator", { pinnedAt: at }), ...chats(8)],
        coordinatorThreadId: "coordinator",
      }),
    ).toBe(false);
  });
});
