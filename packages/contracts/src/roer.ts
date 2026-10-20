import * as Schema from "effect/Schema";

import { ThreadId } from "./baseSchemas.ts";

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

export const RoerThreadPlacement = Schema.Struct({
  /** False when this environment has no Roer URL and token; the UI then offers nothing. */
  configured: Schema.Boolean,
  location: RoerThreadLocation,
  /** Roer's job for this thread, once it became one. */
  jobId: Schema.NullOr(Schema.String),
  /** Where to follow the thread while it runs in the cloud. */
  jobUrl: Schema.NullOr(Schema.String),
  branch: Schema.NullOr(Schema.String),
});
export type RoerThreadPlacement = typeof RoerThreadPlacement.Type;

export class RoerError extends Schema.TaggedError<RoerError>()("RoerError", {
  detail: Schema.String,
}) {
  override get message() {
    return this.detail;
  }
}
