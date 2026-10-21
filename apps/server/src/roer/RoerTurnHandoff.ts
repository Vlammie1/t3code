import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";

import * as Settings from "../serverSettings.ts";

const decodeHandoff = Schema.decodeUnknownEffect(
  Schema.Struct({ overdracht: Schema.NullOr(Schema.String) }),
);

/**
 * The handoff of a thread that came back from Roer's cloud, taken once for the first turn that starts here. A message
 * typed in T3 Code does not pass Roer, so without this the agent here would not know what happened in the cloud.
 * Roer clears it when it sends a message itself, so the two never both deliver it.
 */
export class RoerTurnHandoff extends Context.Service<
  RoerTurnHandoff,
  { readonly take: (threadId: string) => Effect.Effect<string | null> }
>()("t3/roer/RoerTurnHandoff") {}

export const layer = Layer.effect(
  RoerTurnHandoff,
  Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient;
    const settingsService = yield* Settings.ServerSettingsService;
    const take = Effect.fn("RoerTurnHandoff.take")(function* (threadId: string) {
      const roer = yield* settingsService.getSettings.pipe(Effect.map((settings) => settings.roer));
      if (!roer.url || !roer.token) return null;
      const root = roer.url.endsWith("/") ? roer.url : `${roer.url}/`;
      const url = new URL(
        `api/t3/thread/${encodeURIComponent(threadId)}/overdracht`,
        root,
      ).toString();
      const response = yield* client.execute(
        HttpClientRequest.post(url).pipe(
          HttpClientRequest.bodyJsonUnsafe({}),
          HttpClientRequest.setHeader("Authorization", `Bearer ${roer.token}`),
        ),
      );
      if (response.status < 200 || response.status >= 300) return null;
      return (yield* decodeHandoff(yield* response.json)).overdracht;
    });
    return RoerTurnHandoff.of({
      take: (threadId) =>
        take(threadId).pipe(
          // A slow or unreachable Roer must not hold up or fail a turn here.
          Effect.timeout("3 seconds"),
          // Request spans record headers, and this one carries the token.
          Effect.withTracerEnabled(false),
          Effect.orElseSucceed(() => null),
        ),
    });
  }),
);

/** How the handoff reaches the agent, ahead of the user's message. */
export const roerHandoffNote = (handoff: string) =>
  `This thread ran on Roer's cloud worker in between and is back on this machine. What happened there:\n\n${handoff}`;
