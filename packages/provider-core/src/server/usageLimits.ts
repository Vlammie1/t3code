import type {
  ProviderUsageLimitsUpdate,
  ServerProviderUsageLimits,
  ServerProviderUsageWindow,
} from "@t3tools/contracts";

const WINDOW_KIND_ORDER: Record<ServerProviderUsageWindow["kind"], number> = {
  session: 0,
  weekly: 1,
  monthly: 2,
  other: 3,
};

export function clampPercent(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
}

function sortWindows(
  windows: Iterable<ServerProviderUsageWindow>,
): ReadonlyArray<ServerProviderUsageWindow> {
  return [...windows].toSorted(
    (left, right) =>
      WINDOW_KIND_ORDER[left.kind] - WINDOW_KIND_ORDER[right.kind] ||
      left.id.localeCompare(right.id),
  );
}

export function makeUsageLimits(input: {
  readonly checkedAt: string;
  readonly windows: Iterable<ServerProviderUsageWindow>;
}): ServerProviderUsageLimits {
  return { checkedAt: input.checkedAt, windows: sortWindows(input.windows) };
}

export function makeUnavailableUsageLimits(input: {
  readonly checkedAt: string;
  readonly reason: "unsupported" | "probeFailed";
  readonly message?: string;
}): ServerProviderUsageLimits {
  return {
    checkedAt: input.checkedAt,
    windows: [],
    unavailable: {
      reason: input.reason,
      ...(input.message ? { message: input.message } : {}),
    },
  };
}

// Windows start at a fixed moment, so a reset time that moves by less than this
// is the same window reported with other rounding by another source (the
// streamed event in epoch seconds, the usage endpoints as ISO strings).
const SAME_WINDOW_RESET_TOLERANCE_MS = 10 * 60_000;

function resetMillis(window: ServerProviderUsageWindow): number | null {
  if (window.resetsAt === undefined) return null;
  const at = Date.parse(window.resetsAt);
  return Number.isFinite(at) ? at : null;
}

/**
 * Usage only grows inside one window. Several sources report it: every live
 * provider session streams its own event, and the account endpoints are polled
 * on their own clocks and can lag behind the stream. Whichever lands last must
 * not pull the bar back, so inside one window the highest reading wins. A
 * passed or later reset is a new window and starts from the incoming reading;
 * a reading for an earlier reset is stale and dropped. Without reset times the
 * window cannot be told apart, so the incoming reading stands.
 */
export function mergeUsageWindow(
  existing: ServerProviderUsageWindow | undefined,
  incoming: ServerProviderUsageWindow,
  now: number,
): ServerProviderUsageWindow {
  if (existing === undefined) return incoming;
  const existingReset = resetMillis(existing);
  const incomingReset = resetMillis(incoming);
  if (existingReset === null || existingReset <= now) return incoming;
  if (incomingReset !== null) {
    if (incomingReset > existingReset + SAME_WINDOW_RESET_TOLERANCE_MS) return incoming;
    if (incomingReset < existingReset - SAME_WINDOW_RESET_TOLERANCE_MS) return existing;
  }
  return incoming.usedPercent >= existing.usedPercent
    ? incoming
    : { ...incoming, usedPercent: existing.usedPercent };
}

export function applyUsageLimitsUpdate(input: {
  readonly previous: ServerProviderUsageLimits | undefined;
  readonly update: ProviderUsageLimitsUpdate;
  readonly checkedAt: string;
}): ServerProviderUsageLimits | undefined {
  const { previous, update } = input;
  if (update.windows.length === 0 || previous?.unavailable?.reason === "unsupported") {
    return previous;
  }
  const merged = new Map(previous?.windows.map((window) => [window.id, window] as const));
  // Codex sends this notification beside every token-usage tick, almost
  // always with unchanged numbers. Decide "nothing changed" per window on
  // the way through so the no-op case never allocates a new snapshot.
  let changed = false;
  const now = Date.parse(input.checkedAt);
  for (const window of update.windows) {
    const existing = merged.get(window.id);
    const next = mergeUsageWindow(
      existing,
      {
        ...window,
        usedPercent: clampPercent(window.usedPercent),
        ...(window.resetsAt === undefined && existing?.resetsAt !== undefined
          ? { resetsAt: existing.resetsAt }
          : {}),
        ...(window.windowDurationMins === undefined && existing?.windowDurationMins !== undefined
          ? { windowDurationMins: existing.windowDurationMins }
          : {}),
      },
      now,
    );
    if (existing === undefined || !usageWindowEquals(existing, next)) {
      merged.set(window.id, next);
      changed = true;
    }
  }
  if (!changed && previous !== undefined && previous.unavailable === undefined) {
    return previous;
  }
  return {
    ...makeUsageLimits({ checkedAt: input.checkedAt, windows: merged.values() }),
    ...(previous?.resetCredits !== undefined ? { resetCredits: previous.resetCredits } : {}),
  };
}

function usageWindowEquals(a: ServerProviderUsageWindow, b: ServerProviderUsageWindow): boolean {
  return (
    a.id === b.id &&
    a.kind === b.kind &&
    a.label === b.label &&
    a.usedPercent === b.usedPercent &&
    a.resetsAt === b.resetsAt &&
    a.windowDurationMins === b.windowDurationMins
  );
}

export function resolveUsageLimitsAfterProbe(input: {
  readonly published: ServerProviderUsageLimits | undefined;
  readonly probed: ServerProviderUsageLimits | undefined;
}): ServerProviderUsageLimits | undefined {
  const { published, probed } = input;
  if (probed?.unavailable?.reason === "probeFailed" && published && !published.unavailable) {
    return published;
  }
  if (probed === undefined || probed.unavailable || published === undefined) return probed;
  // A redeemed reset credit is the one legitimate drop inside a window, so the
  // probe after it is authoritative. A probe that could not read the credits
  // counts as one too: holding the bar up past a real reset is worse.
  const creditSpent =
    published.resetCredits !== undefined &&
    (probed.resetCredits?.availableCount ?? 0) < published.resetCredits.availableCount;
  if (creditSpent) return probed;
  const previous = new Map(published.windows.map((window) => [window.id, window] as const));
  const now = Date.parse(probed.checkedAt);
  return {
    ...probed,
    windows: probed.windows.map((window) => mergeUsageWindow(previous.get(window.id), window, now)),
  };
}
