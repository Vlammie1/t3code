import { describe, expect, it } from "vitest";
import type { RoerActivityEntry } from "@t3tools/contracts";

import { applyRoerRegels, type RoerRegel } from "./roerActivity.ts";

const regel = (volgnr: number, gebeurtenis: RoerRegel["gebeurtenis"]): RoerRegel => ({
  volgnr,
  tijd: `2026-10-21T10:00:0${volgnr}.000Z`,
  gebeurtenis,
});

describe("applyRoerRegels", () => {
  it("makes one tool entry of its start and end, and a repeated start does not revive it", () => {
    const entries = new Map<string, RoerActivityEntry>();
    const start = regel(1, {
      soort: "stap_begin",
      id: "t1",
      gereedschap: "Edit",
      invoer: { file_path: "src/login.ts" },
    });
    applyRoerRegels(entries, [start]);
    expect([...entries.values()]).toMatchObject([
      { id: "step:t1", kind: "tool", text: "src/login.ts", live: true },
    ]);
    const end = regel(2, {
      soort: "stap_eind",
      id: "t1",
      status: "ok",
      uitvoer: "",
      diff: { bestand: "src/login.ts", plus: 3, min: 1, stukken: [] },
    });
    expect(applyRoerRegels(entries, [start, end])).toMatchObject([
      {
        id: "step:t1",
        live: false,
        tool: { name: "Edit", failed: false, additions: 3, deletions: 1 },
      },
    ]);
    expect(applyRoerRegels(entries, [start])).toEqual([]);
  });

  it("leaves out what a subagent does and the progress notes of a move", () => {
    const changed = applyRoerRegels(new Map(), [
      regel(1, { soort: "melding", tekst: "Verplaatsen naar de laptop…" }),
      regel(2, { soort: "stap_begin", id: "s1", gereedschap: "Bash", invoer: {}, binnen: "a1" }),
      regel(3, { soort: "tekst", tekst: "binnenin", klaar: true, binnen: "a1" }),
      regel(4, { soort: "melding", tekst: "Terug op de laptop.", naar: "laptop" }),
    ]);
    expect(changed.map((entry) => [entry.kind, entry.text])).toEqual([
      ["notice", "Back on this machine"],
    ]);
  });
});
