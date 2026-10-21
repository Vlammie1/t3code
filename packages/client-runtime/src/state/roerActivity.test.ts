import type { RoerActivityEntry, RoerThreadPlacement } from "@t3tools/contracts";
import { describe, expect, it } from "vitest";

import { EMPTY_ROER_ACTIVITY, foldRoerActivity } from "./roerActivity.ts";

const placement: RoerThreadPlacement = {
  configured: true,
  location: "cloud",
  running: true,
  jobId: "klus_1",
  jobUrl: null,
  branch: null,
};
const entry = (seq: number, text: string): RoerActivityEntry => ({
  id: String(seq),
  seq,
  at: "2026-10-21T10:00:00.000Z",
  kind: "assistant",
  text,
  live: true,
  tool: null,
});

describe("foldRoerActivity", () => {
  it("replaces changed entries by id, adds new ones in order, and leaves the rest alone", () => {
    const first = entry(1, "Ik kijk");
    const full = foldRoerActivity(EMPTY_ROER_ACTIVITY, {
      placement,
      replace: true,
      entries: [first, entry(3, "Klaar")],
    });
    const next = foldRoerActivity(full, {
      placement,
      replace: false,
      entries: [entry(3, "Klaar, de test slaagt"), entry(2, "Tussendoor")],
    });
    expect(next.entries.map((item) => item.text)).toEqual([
      "Ik kijk",
      "Tussendoor",
      "Klaar, de test slaagt",
    ]);
    expect(next.entries[0]).toBe(first);
  });
});
