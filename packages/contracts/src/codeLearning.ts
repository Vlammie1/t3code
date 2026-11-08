import * as Schema from "effect/Schema";

import { IsoDateTime, NonNegativeInt, ThreadId } from "./baseSchemas.ts";

/**
 * Code leren: after a turn, a model picks a piece of the code the agent just wrote and hides part of it for the
 * user to write back. A separate model call, not the thread's agent, reviews the attempt, so practising costs a
 * small text generation instead of the thread's context.
 *
 * The level sets how much is hidden: an expression or a few tokens, one whole line, or a block of lines.
 */
export const CodeLearningLevel = Schema.Literals(["fill", "line", "block"]);
export type CodeLearningLevel = typeof CodeLearningLevel.Type;

export const CodeExercise = Schema.Struct({
  id: Schema.String,
  threadId: ThreadId,
  /** The turn whose changes the exercise came from; 0 when it came from the whole thread. */
  turnCount: NonNegativeInt,
  createdAt: IsoDateTime,
  level: CodeLearningLevel,
  /** What was built, in plain words for a beginner. */
  summary: Schema.String,
  filePath: Schema.String,
  language: Schema.String,
  /** The code right above the hidden part, unchanged. */
  before: Schema.String,
  /** The hidden part exactly as it is in the file. */
  solution: Schema.String,
  /** The code right below the hidden part, unchanged. */
  after: Schema.String,
  /** What the user has to write, as a short task. */
  task: Schema.String,
  hint: Schema.String,
  /** Why the hidden code looks like this, shown once the user tried or gave up. */
  explanation: Schema.String,
});
export type CodeExercise = typeof CodeExercise.Type;

export const CodeExerciseVerdict = Schema.Literals(["correct", "almost", "wrong"]);
export type CodeExerciseVerdict = typeof CodeExerciseVerdict.Type;

export const CodeExerciseReview = Schema.Struct({
  verdict: CodeExerciseVerdict,
  feedback: Schema.String,
  /** One next step when the attempt was not right yet. */
  tip: Schema.NullOr(Schema.String),
});
export type CodeExerciseReview = typeof CodeExerciseReview.Type;

export const CodeLearningInput = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("generate"),
    threadId: ThreadId,
    level: CodeLearningLevel,
    /**
     * "latest" only uses the newest turn and fails when it wrote no code, which is what an exercise after each turn
     * wants; "any" walks back through recent turns and then the whole thread.
     */
    scope: Schema.Literals(["latest", "any"]),
    /** Solutions of earlier exercises, so a new one picks other code. */
    avoid: Schema.Array(Schema.String.check(Schema.isMaxLength(4_000))).check(
      Schema.isMaxLength(20),
    ),
  }),
  Schema.Struct({
    type: Schema.Literal("review"),
    exercise: CodeExercise,
    answer: Schema.String.check(Schema.isMaxLength(20_000)),
  }),
]);
export type CodeLearningInput = typeof CodeLearningInput.Type;

export const CodeLearningResult = Schema.Union([
  Schema.Struct({ type: Schema.Literal("exercise"), exercise: CodeExercise }),
  Schema.Struct({ type: Schema.Literal("review"), review: CodeExerciseReview }),
]);
export type CodeLearningResult = typeof CodeLearningResult.Type;

export class CodeLearningError extends Schema.TaggedError<CodeLearningError>()(
  "CodeLearningError",
  {
    /** A sentence for the user, in the app's language for this feature. */
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}
