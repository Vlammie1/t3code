import {
  CodeLearningError,
  ProviderInstanceId,
  type ServerSettings as ServerSettingsValue,
  type CodeExercise,
  type CodeLearningInput,
  type CodeLearningLevel,
  type CodeLearningResult,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { createModelSelection } from "@t3tools/shared/model";

import * as CheckpointDiffQuery from "../checkpointing/CheckpointDiffQuery.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as TextGeneration from "../textGeneration/TextGeneration.ts";
import {
  addedCodeOf,
  diffContainsCode,
  focusDiff,
  keepCodeFiles,
  undoOverEscapedCode,
} from "./exerciseDiff.ts";

/**
 * Code leren: an exercise from the code a thread's agent just wrote, and a review of the user's attempt. Neither runs
 * on the thread's own agent, so practising does not spend the thread's context. The exercise comes from the text
 * generation model; the review from Sonnet on low effort when a Claude instance exists, because judging whether
 * a beginner's code works the same is where a small model slips.
 */
export class CodeLearningService extends Context.Service<
  CodeLearningService,
  {
    readonly run: (
      input: CodeLearningInput,
    ) => Effect.Effect<CodeLearningResult, CodeLearningError>;
  }
>()("t3/codeLearning/CodeLearningService") {}

/** Earlier turns are tried when the newest one only touched files that make poor exercises. */
const MAX_TURNS_BACK = 5;
/** Enough for one file with context; more only makes the exercise slower to make. */
const MAX_DIFF_CHARS = 12_000;

const REVIEW_MODEL = "claude-sonnet-5-5";
const CLAUDE_DRIVER = "claudeAgent";

/** Sonnet on the first Claude instance, preferring the one text generation already uses. */
export function reviewModelSelection(settings: ServerSettingsValue) {
  const textGeneration = settings.textGenerationModelSelection;
  const instances: Readonly<Record<string, { readonly driver: string }>> =
    settings.providerInstances;
  const isClaude = (id: string) => (instances[id]?.driver ?? id) === CLAUDE_DRIVER;
  const candidates = [
    textGeneration.instanceId,
    settings.defaultModelSelection?.instanceId,
    ...Object.keys(instances),
  ].filter((id) => id !== undefined);
  const instanceId = candidates.find(isClaude);
  return instanceId === undefined
    ? textGeneration
    : createModelSelection(ProviderInstanceId.make(instanceId), REVIEW_MODEL, [
        { id: "effort", value: "low" },
      ]);
}

const failWith = (detail: string) => (cause: unknown) => new CodeLearningError({ detail, cause });

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagement.ThreadManagementService;
  const diffs = yield* CheckpointDiffQuery.CheckpointDiffQuery;
  const settings = yield* ServerSettings.ServerSettingsService;
  const textGeneration = yield* TextGeneration.TextGeneration;
  const crypto = yield* Crypto.Crypto;

  const completedTurns = Effect.fn("CodeLearningService.completedTurns")(function* (
    threadId: ThreadId,
  ) {
    const context = yield* threads
      .getCheckpointContext(threadId)
      .pipe(Effect.mapError(failWith("Deze chat is niet gevonden.")));
    const completedRunIds = new Set(
      context.runs.filter((run) => run.status === "completed").map((run) => run.id),
    );
    const ready = context.checkpoints.filter(
      (checkpoint) =>
        checkpoint.status === "ready" &&
        checkpoint.appRunOrdinal !== null &&
        checkpoint.runId !== null &&
        completedRunIds.has(checkpoint.runId),
    );
    const turns = [...new Set(ready.map((checkpoint) => checkpoint.appRunOrdinal ?? 0))].toSorted(
      (left, right) => right - left,
    );
    const cwd = context.checkpointScopes[0]?.cwd ?? null;
    return { turns, cwd };
  });

  /** The newest turn that changed code, or the whole thread when no single recent turn did. */
  const findCode = Effect.fn("CodeLearningService.findCode")(function* (
    threadId: ThreadId,
    scope: "latest" | "any",
  ) {
    const { turns, cwd } = yield* completedTurns(threadId);
    if (turns.length === 0 || cwd === null) {
      return yield* new CodeLearningError({
        detail: "Deze chat heeft nog geen afgeronde beurt waarin code is geschreven.",
      });
    }
    for (const turnCount of turns.slice(0, scope === "latest" ? 1 : MAX_TURNS_BACK)) {
      const turnDiff = yield* diffs
        .getTurnDiff({
          threadId,
          fromTurnCount: turnCount - 1,
          toTurnCount: turnCount,
          ignoreWhitespace: false,
        })
        .pipe(Effect.option);
      if (turnDiff._tag === "None") continue;
      const code = focusDiff(keepCodeFiles(turnDiff.value.diff), MAX_DIFF_CHARS);
      if (addedCodeOf(code).trim().length > 0) return { turnCount, diff: code, cwd };
    }
    return yield* new CodeLearningError({
      detail:
        scope === "latest"
          ? "De laatste beurt veranderde geen code."
          : "In de laatste beurten van deze chat is geen code geschreven om mee te oefenen.",
    });
  });

  const modelSelection = settings.getSettings.pipe(
    Effect.map((current) => current.textGenerationModelSelection),
    Effect.mapError(failWith("De instellingen zijn niet te lezen.")),
  );

  const generate = Effect.fn("CodeLearningService.generate")(function* (input: {
    readonly threadId: ThreadId;
    readonly level: CodeLearningLevel;
    readonly scope: "latest" | "any";
    readonly avoid: ReadonlyArray<string>;
  }) {
    const source = yield* findCode(input.threadId, input.scope);
    const selection = yield* modelSelection;
    // A model now and then "remembers" code that is not in the diff; one more try usually lands on real code.
    for (let attempt = 0; attempt < 2; attempt++) {
      const reply = yield* textGeneration
        .generateCodeExercise({
          cwd: source.cwd,
          diffPatch: source.diff,
          level: input.level,
          avoid: input.avoid,
          modelSelection: selection,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new CodeLearningError({
                detail: `Oefening maken lukte niet: ${cause.detail}`,
                cause,
              }),
          ),
        );
      const generated = undoOverEscapedCode(reply);
      if (generated.solution.trim().length === 0) continue;
      if (!diffContainsCode(source.diff, generated.solution)) continue;
      const exercise: CodeExercise = {
        id: yield* crypto.randomUUIDv4().pipe(Effect.orDie),
        threadId: input.threadId,
        turnCount: source.turnCount,
        createdAt: DateTime.formatIso(yield* DateTime.now),
        level: input.level,
        summary: generated.summary.trim(),
        filePath: generated.filePath.trim(),
        language: generated.language.trim().toLowerCase(),
        before: generated.before,
        solution: generated.solution,
        after: generated.after,
        walkthrough: generated.walkthrough
          .map((step) => ({ code: step.code.trim(), explanation: step.explanation.trim() }))
          .filter((step) => step.explanation.length > 0),
        task: generated.task.trim(),
        hint: generated.hint.trim(),
        explanation: generated.explanation.trim(),
      };
      return exercise;
    }
    return yield* new CodeLearningError({
      detail: "Het model koos code die niet in de wijzigingen staat. Probeer het nog eens.",
    });
  });

  const review = Effect.fn("CodeLearningService.review")(function* (
    exercise: CodeExercise,
    answer: string,
  ) {
    if (answer.trim().length === 0) {
      return {
        verdict: "wrong" as const,
        feedback: "Je hebt nog niets ingevuld.",
        tip: "Lees de opdracht en de code eromheen, en typ wat er volgens jou op de lege plek hoort.",
      };
    }
    const { cwd } = yield* completedTurns(exercise.threadId);
    const result = yield* textGeneration
      .reviewCodeExercise({
        cwd: cwd ?? ".",
        summary: exercise.summary,
        filePath: exercise.filePath,
        language: exercise.language,
        before: exercise.before,
        solution: exercise.solution,
        after: exercise.after,
        task: exercise.task,
        answer,
        modelSelection: reviewModelSelection(
          yield* settings.getSettings.pipe(
            Effect.mapError(failWith("De instellingen zijn niet te lezen.")),
          ),
        ),
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new CodeLearningError({ detail: `Nakijken lukte niet: ${cause.detail}`, cause }),
        ),
      );
    return {
      verdict: result.verdict,
      feedback: result.feedback.trim(),
      tip: result.verdict === "correct" ? null : (result.tip?.trim() ?? null),
    };
  });

  const run: CodeLearningService["Service"]["run"] = (input) =>
    input.type === "generate"
      ? generate(input).pipe(Effect.map((exercise) => ({ type: "exercise" as const, exercise })))
      : review(input.exercise, input.answer).pipe(
          Effect.map((review) => ({ type: "review" as const, review })),
        );

  return CodeLearningService.of({ run });
});

export const layer = Layer.effect(CodeLearningService, make);
