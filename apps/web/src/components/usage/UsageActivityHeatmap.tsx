import { formatDayShort, formatTokens, formatUsd } from "@t3tools/shared/usageFormat";
import { useState } from "react";

import { cn } from "../../lib/utils";
import type { ActivityDay, ActivityLevel, UsageActivity } from "./usageActivity";

const LEVEL_CLASS: Record<ActivityLevel, string> = {
  0: "bg-foreground/6",
  1: "bg-primary/25",
  2: "bg-primary/45",
  3: "bg-primary/70",
  4: "bg-primary",
};

/**
 * One square per day in Monday-first week columns, shaded by that day's share of the busiest
 * days. The hovered day reads out beside the label: one pointer handler on the grid instead of
 * a tooltip per square.
 */
export function UsageActivityHeatmap({
  activity,
  metric,
  label,
}: {
  readonly activity: UsageActivity;
  readonly metric: "tokens" | "cost";
  readonly label: string;
}) {
  const [hovered, setHovered] = useState<ActivityDay | null>(null);
  const levelOf = metric === "tokens" ? activity.tokenLevel : activity.costLevel;
  const valueOf = (cell: ActivityDay) => (metric === "tokens" ? cell.tokens : cell.costUsd);
  const format = (cell: ActivityDay) =>
    metric === "tokens" ? `${formatTokens(cell.tokens)} tokens` : formatUsd(cell.costUsd);
  const cellsByDay = new Map(
    activity.weeks.flatMap((week) =>
      week.flatMap((cell) => (cell === null ? [] : [[cell.day, cell] as const])),
    ),
  );
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className="text-xs text-muted-foreground tabular-nums">
        {label}
        {hovered === null ? null : ` · ${formatDayShort(hovered.day)}: ${format(hovered)}`}
      </span>
      <div
        role="img"
        aria-label={`${label} per day`}
        className="flex gap-1"
        onPointerOver={(event) => {
          const day = (event.target as HTMLElement).dataset.day;
          setHovered(day === undefined ? null : (cellsByDay.get(day) ?? null));
        }}
        onPointerLeave={() => setHovered(null)}
      >
        {activity.weeks.map((week) => (
          <div key={week.find((cell) => cell !== null)?.day} className="grid grid-rows-7 gap-1">
            {week.map((cell, index) =>
              cell === null ? (
                // oxlint-disable-next-line react/no-array-index-key -- padding cells have no day
                <span key={`pad-${index}`} className="size-4" />
              ) : (
                <span
                  key={cell.day}
                  data-day={cell.day}
                  className={cn(
                    "size-4 rounded-sm",
                    LEVEL_CLASS[levelOf(valueOf(cell))],
                    hovered?.day === cell.day && "ring-1 ring-foreground/40",
                  )}
                />
              ),
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export function UsageActivityLegend() {
  return (
    <span aria-hidden className="flex items-center gap-1 text-2xs text-muted-foreground">
      Less
      {([0, 1, 2, 3, 4] as const).map((level) => (
        <span key={level} className={cn("size-2.5 rounded-xs", LEVEL_CLASS[level])} />
      ))}
      More
    </span>
  );
}
