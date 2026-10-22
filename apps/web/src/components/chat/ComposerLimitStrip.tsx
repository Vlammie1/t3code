import type {
  ServerProvider,
  ServerProviderUsageWindow,
  UsageLimitsReport,
} from "@t3tools/contracts";
import {
  elapsedShare,
  formatDuration,
  limitsNotice,
  spentPercent,
} from "@t3tools/shared/usageLimits";

import { useNowMinute } from "../../hooks/useNowMinute";
import {
  formatPromptCacheSize,
  type PromptCacheSize,
  type PromptCacheWindow,
} from "../../lib/contextWindow";
import { cn } from "~/lib/utils";
import { barColor } from "../usage/UsageLimits";
import { ComposerBanner } from "./ComposerBanner";

// Above these shares the bar switches from the provider colour to a status
// colour, so a nearly spent window reads as a warning at a glance.
const HIGH_SPENT_PERCENT = 80;
const FULL_SPENT_PERCENT = 95;

function fillColor(driver: ServerProvider["driver"], spent: number): string {
  if (spent >= FULL_SPENT_PERCENT) return "var(--destructive)";
  if (spent >= HIGH_SPENT_PERCENT) return "var(--warning)";
  return barColor(driver);
}

function resetsInLabel(window: ServerProviderUsageWindow, now: number): string | null {
  if (window.resetsAt === undefined) return null;
  const resetsAt = Date.parse(window.resetsAt);
  if (!Number.isFinite(resetsAt)) return null;
  return resetsAt <= now ? "now" : formatDuration(resetsAt - now);
}

function LimitSegment(props: {
  readonly driver: ServerProvider["driver"];
  readonly label: string;
  readonly window: ServerProviderUsageWindow;
  readonly now: number;
  readonly onOpen: () => void;
}) {
  const { driver, window, now } = props;
  const spent = spentPercent(window);
  const resetsIn = resetsInLabel(window, now);
  const elapsed = elapsedShare(window, now);
  // The marker sits at the share of the window that has passed: a fill that
  // stays left of it lasts until the reset.
  const elapsedPercent = elapsed === null ? null : elapsed * 100;
  const color = fillColor(driver, spent);
  return (
    <button
      type="button"
      onClick={props.onOpen}
      aria-label={`${props.label}: ${spent}% used${elapsedPercent === null ? "" : `, ${Math.round(elapsedPercent)}% of the window passed`}${resetsIn ? `, resets in ${resetsIn}` : ""}`}
      className="group/limit flex min-w-0 flex-col gap-1.5 rounded-lg px-2 py-1.5 text-start transition-colors hover:bg-foreground/5"
    >
      <span className="flex min-w-0 items-baseline gap-1.5 text-xs">
        <span className="truncate text-muted-foreground group-hover/limit:text-foreground">
          {props.label}
        </span>
        <span
          className={cn(
            "ms-auto shrink-0 font-medium tabular-nums",
            spent >= HIGH_SPENT_PERCENT ? "text-warning-foreground" : "text-foreground",
          )}
        >
          {spent}%
        </span>
        {resetsIn ? (
          <span className="shrink-0 text-muted-foreground/70 tabular-nums">{resetsIn}</span>
        ) : null}
      </span>
      <span className="relative block h-1 w-full rounded-full bg-foreground/8">
        <span
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out"
          style={{
            width: `${spent}%`,
            backgroundColor: color,
            boxShadow: `0 0 8px color-mix(in srgb, ${color} 55%, transparent)`,
          }}
        />
        {elapsedPercent !== null ? (
          <span
            aria-hidden
            className="absolute -inset-y-0.5 w-0.5 -translate-x-1/2 rounded-full bg-foreground/60"
            style={{ left: `${elapsedPercent}%` }}
          />
        ) : null}
      </span>
    </button>
  );
}

// Below this the cache is close enough to expiring that the next turn may write it again.
const CACHE_LOW_SHARE = 0.1;

function CacheSegment(props: {
  readonly driver: ServerProvider["driver"];
  readonly cache: PromptCacheWindow;
  readonly size: PromptCacheSize | null;
  readonly now: number;
}) {
  const left = Math.max(0, Date.parse(props.cache.refreshedAt) + props.cache.ttlMs - props.now);
  const share = Math.min(1, left / props.cache.ttlMs);
  const color = share < CACHE_LOW_SHARE ? "var(--warning)" : barColor(props.driver);
  const leftLabel = left === 0 ? "Expired" : formatDuration(left);
  // An expired cache holds nothing; the next request writes it again.
  const sizeLabel = props.size === null || left === 0 ? null : formatPromptCacheSize(props.size);
  return (
    <div
      role="meter"
      aria-label={`Prompt cache${sizeLabel === null ? "" : ` of ${sizeLabel} tokens`}: ${left === 0 ? "expired" : `${leftLabel} left`}`}
      aria-valuenow={Math.round(share * 100)}
      aria-valuemin={0}
      aria-valuemax={100}
      className="flex min-w-0 flex-col gap-1.5 px-2 py-1.5"
    >
      <span className="flex min-w-0 items-baseline gap-1.5 text-xs">
        <span className="truncate text-muted-foreground">Cache</span>
        {sizeLabel === null ? null : (
          <span className="ms-auto shrink-0 font-medium text-foreground tabular-nums">
            {sizeLabel}
          </span>
        )}
        <span
          className={cn(
            "shrink-0 text-muted-foreground/70 tabular-nums",
            sizeLabel === null && "ms-auto",
          )}
        >
          {leftLabel}
        </span>
      </span>
      <span className="relative block h-1 w-full rounded-full bg-foreground/8">
        <span
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ease-out"
          style={{ width: `${share * 100}%`, backgroundColor: color }}
        />
      </span>
    </div>
  );
}

/**
 * The selected provider's session and weekly windows, attached to the top of the composer.
 * Model-scoped weekly windows stay in the full /usage-limits panel, which each segment opens.
 */
export function ComposerLimitStrip(props: {
  readonly report: UsageLimitsReport;
  readonly onOpen: () => void;
  readonly promptCache: PromptCacheWindow | null;
  readonly promptCacheSize: PromptCacheSize | null;
}) {
  const nowMinute = useNowMinute();
  // The minute tick is a UTC ISO prefix without its zone; parse it as UTC.
  const now = Date.parse(`${nowMinute}Z`);
  const accounts = props.report.accounts.filter((account) => limitsNotice(account.limits) === null);
  const segments = accounts.flatMap((account) =>
    // The first window of each kind is the account-wide one; later weekly ones are model-scoped.
    (["session", "weekly"] as const)
      .flatMap((kind) => {
        const window = account.limits.windows.find((candidate) => candidate.kind === kind);
        return window === undefined ? [] : [window];
      })
      .map((window) => ({
        key: `${account.id}:${window.id}`,
        driver: account.driver,
        label: accounts.length > 1 ? `${account.label} · ${window.label}` : window.label,
        window,
      })),
  );
  const cacheDriver = accounts[0]?.driver;
  const cache =
    props.promptCache === null || cacheDriver === undefined
      ? null
      : { driver: cacheDriver, window: props.promptCache };
  if (segments.length === 0 && cache === null) return null;
  const columns = Math.min(segments.length + (cache === null ? 0 : 1), 4);

  return (
    <ComposerBanner.Attachment data-chat-composer-limit-strip="true">
      <ComposerBanner.Root>
        <div
          className="grid gap-1 px-1"
          style={{
            gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          }}
        >
          {segments.map((segment) => (
            <LimitSegment
              key={segment.key}
              driver={segment.driver}
              label={segment.label}
              window={segment.window}
              now={now}
              onOpen={props.onOpen}
            />
          ))}
          {cache === null ? null : (
            <CacheSegment
              driver={cache.driver}
              cache={cache.window}
              size={props.promptCacheSize}
              now={now}
            />
          )}
        </div>
      </ComposerBanner.Root>
    </ComposerBanner.Attachment>
  );
}
