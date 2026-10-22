import { CommandId, type OrchestrationV2ThreadShell, type ProjectId } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";

/**
 * From this many chats the coordinator scrolls out of view in the sidebar, so
 * it is pinned once. It stays a real pin: the user can unpin it, and the brief
 * remembers that it was pinned so it is not pinned again.
 */
export const COORDINATOR_PIN_THREAD_COUNT = 5;

export type CountedThread = Pick<
  OrchestrationV2ThreadShell,
  "id" | "deletedAt" | "archivedAt" | "pinnedAt" | "lineage"
>;

export function shouldPinCoordinator(input: {
  readonly threads: ReadonlyArray<CountedThread>;
  readonly coordinatorThreadId: string;
}): boolean {
  let coordinator: CountedThread | undefined;
  let count = 0;
  for (const thread of input.threads) {
    if (thread.deletedAt !== null || thread.archivedAt !== null) continue;
    // Subagents belong to the thread that delegated them, as on the project page.
    if (thread.lineage.relationshipToParent === "subagent") continue;
    count += 1;
    if (thread.id === input.coordinatorThreadId) coordinator = thread;
  }
  return (
    coordinator !== undefined &&
    coordinator.pinnedAt == null &&
    count >= COORDINATOR_PIN_THREAD_COUNT
  );
}

export class CoordinatorPinReactor extends Context.Service<
  CoordinatorPinReactor,
  { readonly start: () => Effect.Effect<void, never, Scope.Scope> }
>()("t3/project/CoordinatorPinReactor") {}

const make = Effect.gen(function* () {
  const engine = yield* Orchestrator.OrchestratorV2;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const settings = yield* ServerSettings.ServerSettingsService;

  const check = Effect.fn("CoordinatorPinReactor.check")(function* (projectId: ProjectId) {
    const brief = (yield* settings.getSettings).projectBriefs[projectId];
    if (brief?.coordinatorThreadId == null || brief.coordinatorPinned === true) return;
    const { threads } = yield* projections.getShellSnapshot({ location: "active", projectId });
    if (!shouldPinCoordinator({ threads, coordinatorThreadId: brief.coordinatorThreadId })) return;
    yield* engine.dispatch({
      type: "thread.pin",
      commandId: CommandId.make(`server:coordinator-pin:${brief.coordinatorThreadId}`),
      threadId: brief.coordinatorThreadId,
    });
    yield* settings.updateSettings({
      projectBriefs: { [projectId]: { ...brief, coordinatorPinned: true } },
    });
  });

  const checkSkipped = (projectId: ProjectId) =>
    check(projectId).pipe(
      Effect.catchCause((cause) =>
        Cause.hasInterruptsOnly(cause)
          ? Effect.failCause(cause)
          : Effect.logWarning("coordinator pin skipped", { projectId }),
      ),
    );

  const start: CoordinatorPinReactor["Service"]["start"] = Effect.fn("CoordinatorPinReactor.start")(
    function* () {
      yield* forkParked(
        Effect.gen(function* () {
          // Projects that passed the threshold before this ran are pinned on start.
          const briefs = (yield* settings.getSettings).projectBriefs;
          yield* Effect.forEach(Object.keys(briefs) as Array<ProjectId>, checkSkipped, {
            discard: true,
          });
        }).pipe(Effect.ignoreCause({ log: true })),
      );
      yield* forkParked(
        Stream.runForEach(engine.streamDomainEvents, (event) =>
          event.type === "thread.created" ? checkSkipped(event.payload.projectId) : Effect.void,
        ).pipe(Effect.ignoreCause({ log: true })),
      );
    },
  );

  return CoordinatorPinReactor.of({ start });
});

export const layer = Layer.effect(CoordinatorPinReactor, make);
