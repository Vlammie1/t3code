import type { DailyTotals } from "@t3tools/shared/usageMerge";

export interface ActivityDay {
  readonly day: string;
  readonly tokens: number;
  readonly costUsd: number;
}

export type ActivityLevel = 0 | 1 | 2 | 3 | 4;

export interface UsageActivity {
  /** Week columns, Monday first; `null` pads the days before the window starts. */
  readonly weeks: ReadonlyArray<ReadonlyArray<ActivityDay | null>>;
  readonly currentStreak: number;
  readonly longestStreak: number;
  readonly activeDays: number;
  readonly tokenLevel: (tokens: number) => ActivityLevel;
  readonly costLevel: (costUsd: number) => ActivityLevel;
}

function mondayIndex(day: string): number {
  return (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
}

/**
 * Quartiles of the days that had any usage, so one heavy day does not flatten every other day
 * into the lowest shade.
 */
function levelScale(values: readonly number[]): (value: number) => ActivityLevel {
  const sorted = values.filter((value) => value > 0).toSorted((left, right) => left - right);
  const at = (share: number) => sorted[Math.floor((sorted.length - 1) * share)] ?? 0;
  const thresholds = [at(0.25), at(0.5), at(0.75)];
  return (value) => {
    if (value <= 0) return 0;
    let level = 1;
    for (const threshold of thresholds) if (value > threshold) level += 1;
    return level as ActivityLevel;
  };
}

export function usageActivity(
  days: readonly string[],
  daily: readonly DailyTotals[],
): UsageActivity {
  const byDay = new Map(daily.map((entry) => [entry.day, entry]));
  const entries: ActivityDay[] = days.map((day) => {
    const totals = byDay.get(day);
    return { day, tokens: totals?.totalTokens ?? 0, costUsd: totals?.costUsd ?? 0 };
  });

  let longestStreak = 0;
  let run = 0;
  for (const entry of entries) {
    run = entry.tokens > 0 ? run + 1 : 0;
    longestStreak = Math.max(longestStreak, run);
  }
  // Today still counts as open: a streak only breaks once a whole day passed without usage.
  let currentStreak = 0;
  const last = entries.length - 1;
  const from = last >= 0 && entries[last]!.tokens === 0 ? last - 1 : last;
  for (let index = from; index >= 0 && entries[index]!.tokens > 0; index -= 1) currentStreak += 1;

  const weeks: Array<Array<ActivityDay | null>> = [];
  const first = entries[0];
  let week: Array<ActivityDay | null> =
    first === undefined ? [] : Array.from({ length: mondayIndex(first.day) }, () => null);
  for (const entry of entries) {
    week.push(entry);
    if (week.length === 7) {
      weeks.push(week);
      week = [];
    }
  }
  if (week.length > 0) weeks.push(week);

  return {
    weeks,
    currentStreak,
    longestStreak,
    activeDays: entries.filter((entry) => entry.tokens > 0).length,
    tokenLevel: levelScale(entries.map((entry) => entry.tokens)),
    costLevel: levelScale(entries.map((entry) => entry.costUsd)),
  };
}
