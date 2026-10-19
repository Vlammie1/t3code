import type { DailyTotals } from "@t3tools/shared/usageMerge";
import { enumerateDays } from "@t3tools/shared/usageFormat";
import { describe, expect, it } from "vite-plus/test";

import { usageActivity } from "./usageActivity";

function daily(entries: Record<string, number>): DailyTotals[] {
  return Object.entries(entries).map(([day, tokens]) => ({
    day,
    totalTokens: tokens,
    costUsd: tokens / 1000,
    byProvider: new Map(),
  }));
}

// 2026-10-12 is a Monday.
const days = enumerateDays("2026-10-08", "2026-10-19");

describe("usageActivity", () => {
  it("keeps a streak alive while today has no usage yet", () => {
    const activity = usageActivity(
      days,
      daily({ "2026-10-16": 10, "2026-10-17": 10, "2026-10-18": 10 }),
    );

    expect(activity.currentStreak).toBe(3);
  });

  it("ends the streak once a whole day passed without usage", () => {
    const activity = usageActivity(days, daily({ "2026-10-16": 10, "2026-10-17": 10 }));

    expect(activity.currentStreak).toBe(0);
    expect(activity.longestStreak).toBe(2);
  });

  it("counts today when it already has usage", () => {
    const activity = usageActivity(days, daily({ "2026-10-18": 5, "2026-10-19": 5 }));

    expect(activity.currentStreak).toBe(2);
    expect(activity.activeDays).toBe(2);
  });

  it("lays days out in Monday-first week columns", () => {
    const activity = usageActivity(days, []);

    // Thursday the 8th sits in row 3 of the first column, behind three padding cells.
    expect(activity.weeks[0]?.slice(0, 4).map((cell) => cell?.day ?? null)).toEqual([
      null,
      null,
      null,
      "2026-10-08",
    ]);
    expect(activity.weeks[1]?.[0]?.day).toBe("2026-10-12");
    expect(activity.weeks[2]?.map((cell) => cell?.day)).toEqual(["2026-10-19"]);
  });

  it("shades by quartile so one heavy day does not flatten the rest", () => {
    const activity = usageActivity(
      days,
      daily({ "2026-10-15": 1, "2026-10-16": 2, "2026-10-17": 3, "2026-10-18": 1_000_000 }),
    );

    expect(activity.tokenLevel(0)).toBe(0);
    expect(activity.tokenLevel(1)).toBe(1);
    expect(activity.tokenLevel(3)).toBe(3);
    expect(activity.tokenLevel(1_000_000)).toBe(4);
  });
});
