import type {
  OrchestrationV2ProviderTurn,
  OrchestrationV2Run,
  OrchestrationV2TurnItem,
  ProviderThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

/**
 * How long a coordinator's provider cache is assumed to live when the provider
 * does not report it. Claude Code on a subscription writes its prompt cache
 * with a one-hour TTL (API keys get five minutes, which Claude does report), so
 * after an hour of quiet the cache is cold for every known provider.
 */
export const COORDINATOR_DEFAULT_CACHE_TTL_MS = 60 * 60_000;

/**
 * The coordinator's conversation grows with every thread it plans and follows.
 * Resuming it on a cold cache sends all of it again at the cache-write price,
 * so past the cache lifetime it starts a fresh native session instead. Inside
 * the lifetime the resumed session reads the cache cheaply and keeps going.
 */
export function coordinatorCacheExpired(input: {
  readonly providerTurns: ReadonlyArray<
    Pick<OrchestrationV2ProviderTurn, "providerThreadId" | "completedAt" | "tokenUsage">
  >;
  readonly providerThreadId: ProviderThreadId;
  readonly now: number;
}): boolean {
  let lastRequestAt: number | null = null;
  let ttl: { readonly ms: number; readonly at: number } | null = null;
  for (const turn of input.providerTurns) {
    if (turn.providerThreadId !== input.providerThreadId) continue;
    // Every request renews the cache, so the last usage report is its start.
    const at =
      turn.tokenUsage !== undefined
        ? Date.parse(turn.tokenUsage.updatedAt)
        : turn.completedAt !== null
          ? DateTime.toEpochMillis(turn.completedAt)
          : null;
    if (at === null || !Number.isFinite(at)) continue;
    if (lastRequestAt === null || at > lastRequestAt) lastRequestAt = at;
    const reportedTtl = turn.tokenUsage?.promptCacheTtlMs;
    if (reportedTtl !== undefined && (ttl === null || at >= ttl.at)) {
      ttl = { ms: reportedTtl, at };
    }
  }
  if (lastRequestAt === null) return false;
  return input.now - lastRequestAt > (ttl?.ms ?? COORDINATOR_DEFAULT_CACHE_TTL_MS);
}

/**
 * What a fresh coordinator session carries over: its opening briefing, which
 * says how to work, and the one exchange before this run. Everything else stays
 * readable through `t3_thread_read`, which the handoff text points to.
 */
export function coordinatorRecapItems(input: {
  readonly items: ReadonlyArray<OrchestrationV2TurnItem>;
  readonly runs: ReadonlyArray<Pick<OrchestrationV2Run, "id" | "ordinal" | "startedAt">>;
  readonly targetOrdinal: number;
}): ReadonlyArray<OrchestrationV2TurnItem> {
  let previous: Pick<OrchestrationV2Run, "id" | "ordinal"> | undefined;
  let first: Pick<OrchestrationV2Run, "id" | "ordinal"> | undefined;
  for (const run of input.runs) {
    if (run.ordinal >= input.targetOrdinal || run.startedAt === null) continue;
    if (previous === undefined || run.ordinal > previous.ordinal) previous = run;
    if (first === undefined || run.ordinal < first.ordinal) first = run;
  }
  if (previous === undefined) return [];
  const briefing =
    first !== undefined && first.id !== previous.id
      ? input.items.find((item) => item.runId === first.id && item.type === "user_message")
      : undefined;
  return input.items.filter((item) => item === briefing || item.runId === previous.id);
}
