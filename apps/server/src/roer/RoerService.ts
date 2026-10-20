import {
  RoerError,
  type RoerMoveThreadInput,
  type RoerSettings,
  type RoerThreadInput,
  type RoerThreadPlacement,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientError, HttpClientRequest } from "effect/http";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as Settings from "../serverSettings.ts";

/**
 * Roer moves a thread between this machine and its cloud worker: the working tree goes through a branch of its own,
 * the conversation as a handoff, and the turn keeps running on the other side. The move itself happens in Roer and in
 * Mate on this machine; this service only asks Roer where a thread is and to move it, so the action also works from
 * T3 Code and not just from Roer's own apps.
 */
export class RoerService extends Context.Service<
  RoerService,
  {
    readonly placement: (input: RoerThreadInput) => Effect.Effect<RoerThreadPlacement, RoerError>;
    readonly moveThread: (
      input: RoerMoveThreadInput,
    ) => Effect.Effect<RoerThreadPlacement, RoerError>;
  }
>()("t3/roer/RoerService") {}

const RoerAnswer = Schema.Struct({
  klusId: Schema.NullOr(Schema.String),
  waar: Schema.Literals(["laptop", "server"]),
  branch: Schema.NullOr(Schema.String),
});
const decodeAnswer = Schema.decodeUnknownEffect(RoerAnswer);
const decodeRefusal = Schema.decodeUnknownEffect(Schema.Struct({ fout: Schema.String }));

const NOT_CONFIGURED: RoerThreadPlacement = {
  configured: false,
  location: "local",
  jobId: null,
  jobUrl: null,
  branch: null,
};

// Only the kind of failure reaches the client: Roer's URL and token stay on the server.
const describeFailure = (error: unknown) => {
  if (Cause.isTimeoutError(error)) return "Roer did not answer in time.";
  if (HttpClientError.isHttpClientError(error) && error.reason._tag === "StatusCodeError") {
    return `Roer answered with HTTP ${error.reason.response.status}.`;
  }
  return "Roer could not be reached.";
};

const make = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  const settingsService = yield* Settings.ServerSettingsService;
  const threads = yield* ThreadManagementService.ThreadManagementService;

  const config = settingsService.getSettings.pipe(
    Effect.map((settings) => settings.roer),
    Effect.mapError(() => new RoerError({ detail: "Could not read the Roer settings." })),
  );

  const request = Effect.fn("RoerService.request")(function* (
    roer: RoerSettings,
    path: string,
    body: unknown,
    timeout: "15 seconds" | "3 minutes",
  ) {
    const root = roer.url.endsWith("/") ? roer.url : `${roer.url}/`;
    const url = yield* Effect.try({
      try: () => new URL(`api/${path}`, root).toString(),
      catch: () => new RoerError({ detail: "The Roer URL is not valid." }),
    });
    const base =
      body === undefined
        ? HttpClientRequest.get(url)
        : HttpClientRequest.post(url).pipe(HttpClientRequest.bodyJsonUnsafe(body));
    const response = yield* client
      .execute(base.pipe(HttpClientRequest.setHeader("Authorization", `Bearer ${roer.token}`)))
      .pipe(
        Effect.timeout(timeout),
        // Request spans record headers, and this one carries the token.
        Effect.withTracerEnabled(false),
        Effect.mapError((error) => new RoerError({ detail: describeFailure(error) })),
      );
    const json = yield* response.json.pipe(Effect.orElseSucceed(() => null));
    if (response.status === 409) {
      // Roer's own reason, such as local changes since the move; it is meant for the person moving the thread.
      const refusal = yield* decodeRefusal(json).pipe(Effect.option);
      return yield* new RoerError({
        detail: refusal._tag === "Some" ? refusal.value.fout : "Roer refused to move the thread.",
      });
    }
    if (response.status < 200 || response.status >= 300) {
      return yield* new RoerError({ detail: `Roer answered with HTTP ${response.status}.` });
    }
    const answer = yield* decodeAnswer(json).pipe(
      Effect.mapError(
        () => new RoerError({ detail: "Roer sent an answer this version cannot read." }),
      ),
    );
    return {
      configured: true,
      location: answer.waar === "server" ? "cloud" : "local",
      jobId: answer.klusId,
      // Roer's web app routes by hash from its root, next to the API.
      jobUrl: answer.klusId === null ? null : new URL(`#/klus/${answer.klusId}`, root).toString(),
      branch: answer.branch,
    } satisfies RoerThreadPlacement;
  });

  const placement = Effect.fn("RoerService.placement")(function* (input: RoerThreadInput) {
    const roer = yield* config;
    if (!roer.url || !roer.token) return NOT_CONFIGURED;
    return yield* request(
      roer,
      `t3/thread/${encodeURIComponent(input.threadId)}`,
      undefined,
      "15 seconds",
    );
  });

  const moveThread = Effect.fn("RoerService.moveThread")(function* (input: RoerMoveThreadInput) {
    const roer = yield* config;
    if (!roer.url || !roer.token) {
      return yield* new RoerError({
        detail: "Add your Roer URL and token in Settings → Integrations first.",
      });
    }
    // Roer may not know this thread yet; it then creates its job from this title and project.
    const shell = yield* threads
      .getThreadShell(input.threadId)
      .pipe(Effect.orElseSucceed(() => null));
    if (shell === null) return yield* new RoerError({ detail: "This thread does not exist here." });
    // Packing pushes the working tree and unpacking fetches it, so this waits longer than a lookup.
    return yield* request(
      roer,
      `t3/thread/${encodeURIComponent(input.threadId)}/verplaats`,
      {
        naar: input.to === "cloud" ? "server" : "laptop",
        titel: shell.title,
        project: shell.projectId,
      },
      "3 minutes",
    );
  });

  return RoerService.of({ placement, moveThread });
});

export const layer = Layer.effect(RoerService, make);
