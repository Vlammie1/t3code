import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

/**
 * Where a thread runs when this environment is linked to Roer: here, or on Roer's cloud worker. Moving takes the
 * thread's whole working tree (uncommitted work included) and its conversation along, and back again.
 */
export const RoerThreadLocation = Schema.Literals(["local", "cloud"]);
export type RoerThreadLocation = typeof RoerThreadLocation.Type;

export const RoerThreadInput = Schema.Struct({ threadId: ThreadId });
export type RoerThreadInput = typeof RoerThreadInput.Type;

export const RoerMoveThreadInput = Schema.Struct({
  threadId: ThreadId,
  to: RoerThreadLocation,
});
export type RoerMoveThreadInput = typeof RoerMoveThreadInput.Type;

/** Steering a thread while it runs in the cloud: a message for it, or stopping its turn. */
export const RoerSteerThreadInput = Schema.Struct({
  threadId: ThreadId,
  action: Schema.Union([
    Schema.Struct({
      type: Schema.Literal("send"),
      text: TrimmedNonEmptyString.check(Schema.isMaxLength(20_000)),
    }),
    Schema.Struct({ type: Schema.Literal("interrupt") }),
  ]),
});
export type RoerSteerThreadInput = typeof RoerSteerThreadInput.Type;

export const RoerThreadPlacement = Schema.Struct({
  /** False when this environment has no Roer URL and token; the UI then offers nothing. */
  configured: Schema.Boolean,
  location: RoerThreadLocation,
  /** Whether Roer's job for this thread is working right now, wherever it runs. */
  running: Schema.Boolean,
  /** Roer's job for this thread, once it became one. */
  jobId: Schema.NullOr(Schema.String),
  /** Where to follow the thread while it runs in the cloud. */
  jobUrl: Schema.NullOr(Schema.String),
  branch: Schema.NullOr(Schema.String),
});
export type RoerThreadPlacement = typeof RoerThreadPlacement.Type;

/**
 * One thing that happened while the thread ran in the cloud. The thread here stands still meanwhile, so this is the
 * only record of that work on this machine; the chat shows it in place between the turns that ran here.
 */
export const RoerActivityEntry = Schema.Struct({
  /** Stable while it changes: a growing text and a finishing tool replace the entry with the same id. */
  id: Schema.String,
  /** Roer's order within the job. */
  seq: NonNegativeInt,
  at: IsoDateTime,
  kind: Schema.Literals(["user", "assistant", "reasoning", "tool", "notice", "error"]),
  /** The message itself, or for a tool what it ran on: a command, a file, a search. */
  text: Schema.String,
  /** A text still streaming, or a tool still running. */
  live: Schema.Boolean,
  tool: Schema.NullOr(
    Schema.Struct({
      name: Schema.String,
      failed: Schema.Boolean,
      file: Schema.NullOr(Schema.String),
      additions: Schema.NullOr(NonNegativeInt),
      deletions: Schema.NullOr(NonNegativeInt),
    }),
  ),
});
export type RoerActivityEntry = typeof RoerActivityEntry.Type;

/**
 * The cloud part of a thread as it changes. The first frame and any frame with `replace` carry every entry; the rest
 * only what changed, so a streaming answer does not resend the whole history several times a second.
 */
export const RoerThreadActivity = Schema.Struct({
  placement: RoerThreadPlacement,
  replace: Schema.Boolean,
  entries: Schema.Array(RoerActivityEntry),
});
export type RoerThreadActivity = typeof RoerThreadActivity.Type;

export class RoerError extends Schema.TaggedError<RoerError>()("RoerError", {
  detail: Schema.String,
}) {
  override get message() {
    return this.detail;
  }
}
