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

/**
 * The selected provider's limit windows, attached to the top of the composer.
 * Each segment opens the full /usage-limits panel with pace and reset credits.
 */
export function ComposerLimitStrip(props: {
  readonly report: UsageLimitsReport;
  readonly onOpen: () => void;
}) {
  const nowMinute = useNowMinute();
  // The minute tick is a UTC ISO prefix without its zone; parse it as UTC.
  const now = Date.parse(`${nowMinute}Z`);
  const accounts = props.report.accounts.filter((account) => limitsNotice(account.limits) === null);
  const segments = accounts.flatMap((account) =>
    account.limits.windows.map((window) => ({
      key: `${account.id}:${window.id}`,
      driver: account.driver,
      label: accounts.length > 1 ? `${account.label} · ${window.label}` : window.label,
      window,
    })),
  );
  if (segments.length === 0) return null;

  return (
    <ComposerBanner.Attachment data-chat-composer-limit-strip="true">
      <ComposerBanner.Root>
        <div
          className="grid gap-1 px-1"
          style={{
            gridTemplateColumns: `repeat(${Math.min(segments.length, 4)}, minmax(0, 1fr))`,
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
        </div>
      </ComposerBanner.Root>
    </ComposerBanner.Attachment>
  );
}
