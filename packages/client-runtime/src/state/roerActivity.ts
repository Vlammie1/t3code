import type {
  RoerActivityEntry,
  RoerThreadActivity,
  RoerThreadPlacement,
} from "@t3tools/contracts";

/** The cloud part of a thread as the chat shows it: where it runs now, and every entry in Roer's order. */
export interface RoerThreadActivityState {
  /** Null until Roer answered once. */
  readonly placement: RoerThreadPlacement | null;
  readonly entries: ReadonlyArray<RoerActivityEntry>;
}

export const EMPTY_ROER_ACTIVITY: RoerThreadActivityState = { placement: null, entries: [] };

/** Merges a frame from the server into the state: a full frame replaces it, a partial one replaces entries by id. */
export function foldRoerActivity(
  state: RoerThreadActivityState,
  frame: RoerThreadActivity,
): RoerThreadActivityState {
  if (frame.replace) return { placement: frame.placement, entries: frame.entries };
  if (frame.entries.length === 0) return { ...state, placement: frame.placement };
  const changed = new Map(frame.entries.map((entry) => [entry.id, entry] as const));
  const entries = state.entries.map((entry) => {
    const next = changed.get(entry.id);
    if (next === undefined) return entry;
    changed.delete(entry.id);
    return next;
  });
  for (const entry of changed.values()) entries.push(entry);
  entries.sort((left, right) => left.seq - right.seq);
  return { placement: frame.placement, entries };
}
