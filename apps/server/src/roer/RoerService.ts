import {
  RoerError,
  type RoerActivityEntry,
  type RoerMoveThreadInput,
  type RoerSteerThreadInput,
  type RoerSettings,
  type RoerThreadActivity,
  type RoerThreadInput,
  type RoerThreadPlacement,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpClient, HttpClientError, HttpClientRequest } from "effect/http";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import * as Settings from "../serverSettings.ts";
import { applyRoerRegels } from "./roerActivity.ts";

/**
 * Roer moves a thread between this machine and its cloud worker: the working tree goes through a branch of its own,
 * the conversation as a handoff, and the turn keeps running on the other side. The move itself happens in Roer and in
 * Mate on this machine. This service asks Roer where a thread is, moves it, shows what it does in the cloud and sends
 * there, so all of that also works from T3 Code and not just from Roer's own apps.
 */
export class RoerService extends Context.Service<
  RoerService,
  {
    readonly placement: (input: RoerThreadInput) => Effect.Effect<RoerThreadPlacement, RoerError>;
    readonly moveThread: (
      input: RoerMoveThreadInput,
    ) => Effect.Effect<RoerThreadPlacement, RoerError>;
    /** The thread's cloud work as it happens, and what it did in the cloud before; it never fails, it retries. */
    readonly activity: (input: RoerThreadInput) => Stream.Stream<RoerThreadActivity>;
    /** A message for the cloud, or stopping its turn; only while the thread runs there. */
    readonly steerThread: (
      input: RoerSteerThreadInput,
    ) => Effect.Effect<RoerThreadPlacement, RoerError>;
  }
>()("t3/roer/RoerService") {}

const RoerAnswer = Schema.Struct({
  klusId: Schema.NullOr(Schema.String),
  waar: Schema.Literals(["laptop", "server"]),
  status: Schema.optional(Schema.NullOr(Schema.String)),
  branch: Schema.NullOr(Schema.String),
});
type RoerAnswer = typeof RoerAnswer.Type;
const decodeAnswer = Schema.decodeUnknownEffect(RoerAnswer);
const decodeCloud = Schema.decodeUnknownEffect(
  Schema.Struct({
    ...RoerAnswer.fields,
    regels: Schema.Array(
      Schema.Struct({
        volgnr: Schema.Number,
        tijd: Schema.String,
        gebeurtenis: Schema.Record(Schema.String, Schema.Unknown),
      }),
    ),
  }),
);
const decodeRefusal = Schema.decodeUnknownEffect(Schema.Struct({ fout: Schema.String }));

const NOT_CONFIGURED: RoerThreadPlacement = {
  configured: false,
  location: "local",
  running: false,
  jobId: null,
  jobUrl: null,
  branch: null,
};

type Timeout = "15 seconds" | "3 minutes";

// Only the kind of failure reaches the client: Roer's URL and token stay on the server.
const describeFailure = (error: unknown) => {
  if (Cause.isTimeoutError(error)) return "Roer did not answer in time.";
  if (HttpClientError.isHttpClientError(error) && error.reason._tag === "StatusCodeError") {
    return `Roer answered with HTTP ${error.reason.response.status}.`;
  }
  return "Roer could not be reached.";
};

const unreadable = () => new RoerError({ detail: "Roer sent an answer this version cannot read." });

const rootOf = (roer: RoerSettings) => (roer.url.endsWith("/") ? roer.url : `${roer.url}/`);

const threadPath = (threadId: string, rest = "") =>
  `t3/thread/${encodeURIComponent(threadId)}${rest}`;

const toPlacement = (root: string, answer: RoerAnswer): RoerThreadPlacement => ({
  configured: true,
  location: answer.waar === "server" ? "cloud" : "local",
  running: answer.status === "bezig",
  jobId: answer.klusId,
  // Roer's web app routes by hash from its root, next to the API.
  jobUrl: answer.klusId === null ? null : new URL(`#/klus/${answer.klusId}`, root).toString(),
  branch: answer.branch,
});

const samePlacement = (left: RoerThreadPlacement, right: RoerThreadPlacement) =>
  left.configured === right.configured &&
  left.location === right.location &&
  left.running === right.running &&
  left.jobId === right.jobId &&
  left.jobUrl === right.jobUrl &&
  left.branch === right.branch;

/** How long the live view waits before asking again: quick while the cloud works, slow while the thread is here. */
export const activityPollDelay = (placement: RoerThreadPlacement, failures: number) => {
  if (failures > 0) return Duration.seconds(Math.min(30, 2 ** failures));
  if (placement.location === "local") return Duration.seconds(15);
  return Duration.seconds(placement.running ? 1 : 3);
};

const make = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  const settingsService = yield* Settings.ServerSettingsService;
  const threads = yield* ThreadManagementService.ThreadManagementService;

  const config = settingsService.getSettings.pipe(
    Effect.map((settings) => settings.roer),
    Effect.mapError(() => new RoerError({ detail: "Could not read the Roer settings." })),
  );

  const configured = Effect.fn("RoerService.configured")(function* () {
    const roer = yield* config;
    if (!roer.url || !roer.token) {
      return yield* new RoerError({
        detail: "Add your Roer URL and token in Settings → Integrations first.",
      });
    }
    return roer;
  });

  /** Roer's JSON answer, or its own reason for refusing. */
  const request = Effect.fn("RoerService.request")(function* (
    roer: RoerSettings,
    path: string,
    body: unknown,
    timeout: Timeout,
  ) {
    const url = yield* Effect.try({
      try: () => new URL(`api/${path}`, rootOf(roer)).toString(),
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
        detail: refusal._tag === "Some" ? refusal.value.fout : "Roer refused this.",
      });
    }
    if (response.status < 200 || response.status >= 300) {
      return yield* new RoerError({ detail: `Roer answered with HTTP ${response.status}.` });
    }
    return json;
  });

  const placementFor = Effect.fn("RoerService.placementFor")(function* (
    roer: RoerSettings,
    threadId: string,
  ) {
    const json = yield* request(roer, threadPath(threadId), undefined, "15 seconds");
    const answer = yield* decodeAnswer(json).pipe(Effect.mapError(unreadable));
    return toPlacement(rootOf(roer), answer);
  });

  const placement = Effect.fn("RoerService.placement")(function* (input: RoerThreadInput) {
    const roer = yield* config;
    if (!roer.url || !roer.token) return NOT_CONFIGURED;
    return yield* placementFor(roer, input.threadId);
  });

  const moveThread = Effect.fn("RoerService.moveThread")(function* (input: RoerMoveThreadInput) {
    const roer = yield* configured();
    // Roer may not know this thread yet; it then creates its job from this title and project.
    const shell = yield* threads
      .getThreadShell(input.threadId)
      .pipe(Effect.orElseSucceed(() => null));
    if (shell === null) return yield* new RoerError({ detail: "This thread does not exist here." });
    // Packing pushes the working tree and unpacking fetches it, so this waits longer than a lookup.
    const json = yield* request(
      roer,
      threadPath(input.threadId, "/verplaats"),
      {
        naar: input.to === "cloud" ? "server" : "laptop",
        titel: shell.title,
        project: shell.projectId,
      },
      "3 minutes",
    );
    const answer = yield* decodeAnswer(json).pipe(Effect.mapError(unreadable));
    return toPlacement(rootOf(roer), answer);
  });

  /** The job of a thread that runs in the cloud; sending or stopping from here only makes sense there. */
  const cloudJob = Effect.fn("RoerService.cloudJob")(function* (threadId: string) {
    const roer = yield* configured();
    const current = yield* placementFor(roer, threadId);
    if (current.location !== "cloud" || current.jobId === null) {
      return yield* new RoerError({ detail: "This thread runs on this machine again." });
    }
    return { roer, jobId: current.jobId };
  });

  const steerThread = Effect.fn("RoerService.steerThread")(function* (input: RoerSteerThreadInput) {
    const { roer, jobId } = yield* cloudJob(input.threadId);
    const job = `klus/${encodeURIComponent(jobId)}`;
    if (input.action.type === "send") {
      yield* request(roer, `${job}/bericht`, { tekst: input.action.text }, "15 seconds");
    } else {
      yield* request(roer, `${job}/onderbreek`, {}, "15 seconds");
    }
    return yield* placementFor(roer, input.threadId);
  });

  const cloudSince = Effect.fn("RoerService.cloudSince")(function* (
    roer: RoerSettings,
    threadId: string,
    since: string | null,
  ) {
    const query = since === null ? "" : `?sinds=${encodeURIComponent(since)}`;
    const json = yield* request(
      roer,
      threadPath(threadId, `/wolk${query}`),
      undefined,
      "15 seconds",
    );
    const answer = yield* decodeCloud(json).pipe(Effect.mapError(unreadable));
    return { placement: toPlacement(rootOf(roer), answer), regels: answer.regels };
  });

  interface ActivityState {
    readonly first: boolean;
    readonly since: string | null;
    readonly failures: number;
    readonly placement: RoerThreadPlacement;
  }

  const activity = (input: RoerThreadInput): Stream.Stream<RoerThreadActivity> =>
    Stream.unwrap(
      Effect.gen(function* () {
        const roer = yield* config.pipe(Effect.option);
        if (Option.isNone(roer) || !roer.value.url || !roer.value.token) {
          const frame: RoerThreadActivity = {
            placement: NOT_CONFIGURED,
            replace: true,
            entries: [],
          };
          return Stream.succeed(frame);
        }
        const settings = roer.value;
        const entries = new Map<string, RoerActivityEntry>();
        const emit = (frames: ReadonlyArray<RoerThreadActivity>, next: ActivityState) =>
          [frames, Option.some(next)] as const;
        const step = (state: ActivityState) =>
          Effect.gen(function* () {
            if (!state.first) {
              yield* Effect.sleep(activityPollDelay(state.placement, state.failures));
            }
            const answer = yield* cloudSince(settings, input.threadId, state.since).pipe(
              Effect.option,
            );
            if (Option.isNone(answer)) {
              return emit([], { ...state, failures: state.failures + 1 });
            }
            const { placement, regels } = answer.value;
            const changed = applyRoerRegels(entries, regels);
            // Roer returns rows changed at or after `since`, so the newest time seen is where the next ask starts.
            const since = regels.reduce<string | null>(
              (latest, regel) => (latest === null || regel.tijd > latest ? regel.tijd : latest),
              state.since,
            );
            const next: ActivityState = { first: false, since, failures: 0, placement };
            if (state.first) {
              const all = [...entries.values()].sort((left, right) => left.seq - right.seq);
              return emit([{ placement, replace: true, entries: all }], next);
            }
            if (changed.length === 0 && samePlacement(placement, state.placement)) {
              return emit([], next);
            }
            return emit([{ placement, replace: false, entries: changed }], next);
          });
        const initial: ActivityState = {
          first: true,
          since: null,
          failures: 0,
          placement: NOT_CONFIGURED,
        };
        return Stream.paginate(initial, step);
      }),
    );

  return RoerService.of({ placement, moveThread, activity, steerThread });
});

export const layer = Layer.effect(RoerService, make);
