import { describe, expect, it } from "vite-plus/test";
import * as DateTime from "effect/DateTime";
import {
  deriveLatestContextWindowSnapshot,
  formatContextWindowTokens,
  latestProviderTurnTokenUsage,
  promptCacheSize,
  promptCacheWindow,
} from "./contextWindow";

describe("V2 context window presentation", () => {
  it("uses retained compaction token data when available", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      {
        item: {
          id: "compaction-1" as never,
          threadId: "thread-1" as never,
          runId: null,
          nodeId: null,
          providerThreadId: null,
          providerTurnId: null,
          nativeItemRef: null,
          parentItemId: null,
          ordinal: 1,
          status: "completed",
          title: null,
          startedAt: null,
          completedAt: null,
          updatedAt: DateTime.makeUnsafe("2026-06-20T00:00:00.000Z"),
          type: "compaction",
          driver: null,
          beforeTokenCount: 10_000,
          afterTokenCount: 2_000,
        },
      },
    ]);
    expect(snapshot?.usedTokens).toBe(2_000);
    expect(snapshot?.totalProcessedTokens).toBe(10_000);
  });

  it("prefers current provider usage and preserves ACP cost", () => {
    const snapshot = deriveLatestContextWindowSnapshot([], undefined, {
      contextUsage: {
        usedTokens: 2_500,
        maxTokens: 10_000,
        cost: { amount: 0.42, currency: "USD" },
      },
      updatedAt: DateTime.makeUnsafe("2026-08-23T00:00:00.000Z"),
    });

    expect(snapshot).toMatchObject({
      usedTokens: 2_500,
      maxTokens: 10_000,
      remainingTokens: 7_500,
      usedPercentage: 25,
      cost: { amount: 0.42, currency: "USD" },
    });
  });

  it("formats compact token values", () => {
    expect(formatContextWindowTokens(1_500)).toBe("1.5k");
  });

  it.each([
    [999_499, "999k"],
    [999_500, "1m"],
    [999_999, "1m"],
    [1_000_000, "1m"],
    [1_100_000, "1.1m"],
  ])("formats %d tokens as %s at the million boundary", (tokens, expected) => {
    expect(formatContextWindowTokens(tokens)).toBe(expected);
  });
});

describe("live provider-turn usage (#8144)", () => {
  it("prefers the provider's live report over compaction items", () => {
    const snapshot = deriveLatestContextWindowSnapshot([], {
      usedTokens: 42_000,
      maxTokens: 200_000,
      inputTokens: 40_000,
      outputTokens: 2_000,
      updatedAt: "2026-08-27T00:00:00.000Z",
    });
    expect(snapshot).not.toBeNull();
    expect(snapshot?.usedTokens).toBe(42_000);
    expect(snapshot?.maxTokens).toBe(200_000);
    expect(snapshot?.remainingTokens).toBe(158_000);
    expect(snapshot?.usedPercentage).toBe(21);
  });

  it("handles a report without a known context window", () => {
    const snapshot = deriveLatestContextWindowSnapshot([], {
      usedTokens: 42_000,
      updatedAt: "2026-08-27T00:00:00.000Z",
    });
    expect(snapshot?.maxTokens).toBeNull();
    expect(snapshot?.usedPercentage).toBeNull();
  });
});

describe("latestProviderTurnTokenUsage", () => {
  it("picks the newest report, not the last turn in snapshot order", () => {
    const usage = (usedTokens: number, updatedAt: string) => ({
      tokenUsage: { usedTokens, updatedAt },
    });
    const latest = latestProviderTurnTokenUsage([
      usage(300_000, "2026-06-20T12:00:00.000Z"),
      {},
      usage(90_000, "2026-06-20T09:00:00.000Z"),
    ]);
    expect(latest?.usedTokens).toBe(300_000);
  });
});

describe("promptCacheWindow", () => {
  it("lives from the newest report and keeps the TTL of the last cache write", () => {
    const window = promptCacheWindow([
      {
        tokenUsage: {
          usedTokens: 10,
          updatedAt: "2026-06-20T09:00:00.000Z",
          promptCacheTtlMs: 3_600_000,
        },
      },
      // A turn that only read the cache reports no TTL, yet still renews it.
      { tokenUsage: { usedTokens: 20, updatedAt: "2026-06-20T10:00:00.000Z" } },
    ]);
    expect(window).toEqual({ refreshedAt: "2026-06-20T10:00:00.000Z", ttlMs: 3_600_000 });
  });

  it("is unknown until a turn reported a TTL", () => {
    expect(
      promptCacheWindow([
        { tokenUsage: { usedTokens: 10, updatedAt: "2026-06-20T09:00:00.000Z" } },
      ]),
    ).toBeNull();
  });
});

describe("promptCacheSize", () => {
  it("measures the newest request's cache reads plus writes", () => {
    expect(
      promptCacheSize([
        {
          tokenUsage: {
            usedTokens: 10,
            cachedInputTokens: 40_000,
            cacheCreationTokens: 9_000,
            updatedAt: "2026-06-20T09:00:00.000Z",
          },
        },
        {
          tokenUsage: {
            usedTokens: 20,
            cachedInputTokens: 49_000,
            cacheCreationTokens: 1_200,
            updatedAt: "2026-06-20T09:01:00.000Z",
          },
        },
      ]),
    ).toEqual({ tokens: 50_200, includesWrites: true });
  });

  it("says so when writes or the cache itself go unreported", () => {
    expect(
      promptCacheSize([
        {
          tokenUsage: {
            usedTokens: 10,
            cachedInputTokens: 3_000,
            updatedAt: "2026-06-20T09:00:00.000Z",
          },
        },
      ]),
    ).toEqual({ tokens: 3_000, includesWrites: false });
    expect(
      promptCacheSize([{ tokenUsage: { usedTokens: 10, updatedAt: "2026-06-20T09:00:00.000Z" } }]),
    ).toEqual({ tokens: null, includesWrites: false });
    expect(promptCacheSize([])).toBeNull();
  });
});
