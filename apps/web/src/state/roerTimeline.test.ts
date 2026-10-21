import { ThreadId, type RoerActivityEntry } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { mergeRoerTurnItems, roerTurnItems } from "./roerTimeline";

const threadId = ThreadId.make("thread-1");
const entry = (
  seq: number,
  at: string,
  patch: Partial<RoerActivityEntry> = {},
): RoerActivityEntry => ({
  id: String(seq),
  seq,
  at,
  kind: "assistant",
  text: `Stap ${seq}`,
  live: false,
  tool: null,
  ...patch,
});

describe("roerTimeline", () => {
  it("places a stay in the cloud between the turns from here, by time", () => {
    const [before, after] = roerTurnItems(threadId, [
      entry(1, "2026-10-21T09:00:00.000Z"),
      entry(2, "2026-10-21T11:00:00.000Z"),
    ]);
    const cloud = roerTurnItems(threadId, [
      entry(10, "2026-10-21T10:00:00.000Z", { kind: "notice", text: "Moved to the cloud" }),
      entry(11, "2026-10-21T10:05:00.000Z", {
        kind: "tool",
        text: "npm test",
        tool: { name: "Bash", failed: true, file: null, additions: null, deletions: null },
      }),
    ]);
    const merged = mergeRoerTurnItems([before!, after!], cloud);
    expect(merged.map((row) => row.item.type)).toEqual([
      "assistant_message",
      "system_notice",
      "command_execution",
      "assistant_message",
    ]);
    expect(merged[2]!.item.status).toBe("failed");
  });

  it("keeps the rows from here as they are when nothing ran in the cloud, and an entry its row", () => {
    const local = roerTurnItems(threadId, [entry(1, "2026-10-21T09:00:00.000Z")]);
    expect(mergeRoerTurnItems(local, [])).toBe(local);
    const same = entry(2, "2026-10-21T09:00:00.000Z");
    expect(roerTurnItems(threadId, [same])[0]).toBe(roerTurnItems(threadId, [same])[0]);
  });
});
