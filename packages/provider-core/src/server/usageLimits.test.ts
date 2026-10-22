import { describe, expect, it } from "vite-plus/test";

import {
  applyUsageLimitsUpdate,
  mergeUsageWindow,
  resolveUsageLimitsAfterProbe,
} from "./usageLimits.ts";

const checkedAt = "2026-09-03T12:00:00.000Z";
const session = {
  id: "five_hour",
  kind: "session",
  label: "Session",
  usedPercent: 40,
  windowDurationMins: 300,
  resetsAt: "2026-09-03T14:00:00.000Z",
} as const;
const weekly = {
  id: "seven_day",
  kind: "weekly",
  label: "Weekly",
  usedPercent: 20,
  windowDurationMins: 10_080,
} as const;
const published = { checkedAt, windows: [session, weekly] };

describe("applyUsageLimitsUpdate", () => {
  it("returns the published object itself when no window moved", () => {
    // Codex repeats the same numbers beside every token-usage tick; the
    // ingestion path relies on identity to skip the publish.
    const next = applyUsageLimitsUpdate({
      previous: published,
      checkedAt: "2026-09-03T12:00:05.000Z",
      update: {
        windows: [
          { ...weekly },
          { id: "five_hour", kind: "session", label: "Session", usedPercent: 40 },
        ],
      },
    });
    expect(next).toBe(published);
  });

  it("upserts by id and keeps the reset a percent-only update omits", () => {
    const next = applyUsageLimitsUpdate({
      previous: published,
      checkedAt: "2026-09-03T12:00:05.000Z",
      update: {
        windows: [{ id: "five_hour", kind: "session", label: "Session", usedPercent: 55 }],
      },
    });
    expect(next).not.toBe(published);
    expect(next).toEqual({
      checkedAt: "2026-09-03T12:00:05.000Z",
      windows: [{ ...session, usedPercent: 55 }, weekly],
    });
  });

  it("leaves an unsupported account and an empty update alone", () => {
    const unsupported = { checkedAt, windows: [], unavailable: { reason: "unsupported" as const } };
    expect(
      applyUsageLimitsUpdate({ previous: unsupported, checkedAt, update: { windows: [session] } }),
    ).toBe(unsupported);
    expect(
      applyUsageLimitsUpdate({ previous: published, checkedAt, update: { windows: [] } }),
    ).toBe(published);
  });

  it("preserves reset credits when a streamed window update changes usage", () => {
    const resetCredits = { availableCount: 2, nextExpiresAt: "2026-10-01T00:00:00.000Z" };
    const next = applyUsageLimitsUpdate({
      previous: { ...published, resetCredits },
      checkedAt: "2026-09-03T12:00:05.000Z",
      update: { windows: [{ ...session, usedPercent: 55 }] },
    });

    expect(next).toEqual({
      checkedAt: "2026-09-03T12:00:05.000Z",
      windows: [{ ...session, usedPercent: 55 }, weekly],
      resetCredits,
    });
  });
});

describe("mergeUsageWindow", () => {
  const now = Date.parse(checkedAt);

  it("keeps the highest reading inside one window, whatever source lands last", () => {
    // The stream said 55%, then a lagging endpoint poll says 52% for the same reset.
    expect(
      mergeUsageWindow({ ...session, usedPercent: 55 }, { ...session, usedPercent: 52 }, now),
    ).toEqual({ ...session, usedPercent: 55 });
    expect(
      mergeUsageWindow(
        { ...session, usedPercent: 55 },
        // Epoch seconds against an ISO string with milliseconds: still the same window.
        { ...session, usedPercent: 57, resetsAt: "2026-09-03T14:00:01.000Z" },
        now,
      ),
    ).toEqual({ ...session, usedPercent: 57, resetsAt: "2026-09-03T14:00:01.000Z" });
  });

  it("starts over at a new window and drops a reading from an earlier one", () => {
    const next = { ...session, usedPercent: 3, resetsAt: "2026-09-03T19:00:00.000Z" };
    expect(mergeUsageWindow({ ...session, usedPercent: 90 }, next, now)).toBe(next);
    const stale = { ...session, usedPercent: 10, resetsAt: "2026-09-03T09:00:00.000Z" };
    const current = { ...session, usedPercent: 40 };
    expect(mergeUsageWindow(current, stale, now)).toBe(current);
  });

  it("accepts any reading once the known window has passed", () => {
    const fresh = { ...session, usedPercent: 2 };
    expect(
      mergeUsageWindow({ ...session, usedPercent: 90 }, fresh, Date.parse(session.resetsAt)),
    ).toBe(fresh);
  });

  it("cannot tell windows apart without a reset time", () => {
    const lower = { ...weekly, usedPercent: 5 };
    expect(mergeUsageWindow(weekly, lower, now)).toBe(lower);
  });
});

describe("resolveUsageLimitsAfterProbe", () => {
  it("does not let a probe pull a window back inside the same window", () => {
    const probed = {
      checkedAt: "2026-09-03T12:03:00.000Z",
      windows: [{ ...session, usedPercent: 38 }, weekly],
    };
    expect(
      resolveUsageLimitsAfterProbe({
        published: { checkedAt, windows: [{ ...session, usedPercent: 41 }, weekly] },
        probed,
      }),
    ).toEqual({ ...probed, windows: [{ ...session, usedPercent: 41 }, weekly] });
  });

  it("takes the probe as is after a reset credit was spent", () => {
    const probed = {
      checkedAt: "2026-09-03T12:03:00.000Z",
      windows: [{ ...session, usedPercent: 0 }, weekly],
      resetCredits: { availableCount: 1 },
    };
    expect(
      resolveUsageLimitsAfterProbe({
        published: { ...published, resetCredits: { availableCount: 2 } },
        probed,
      }),
    ).toBe(probed);
  });

  it("keeps the last good windows through a failed probe but not an unsupported one", () => {
    const failed = { checkedAt, windows: [], unavailable: { reason: "probeFailed" as const } };
    const unsupported = { checkedAt, windows: [], unavailable: { reason: "unsupported" as const } };
    expect(resolveUsageLimitsAfterProbe({ published, probed: failed })).toBe(published);
    expect(resolveUsageLimitsAfterProbe({ published, probed: unsupported })).toBe(unsupported);
    expect(resolveUsageLimitsAfterProbe({ published: undefined, probed: failed })).toBe(failed);
  });
});
