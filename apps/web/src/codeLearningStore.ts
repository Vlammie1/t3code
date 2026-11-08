import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  runAtomCommand,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import type {
  CodeExercise,
  CodeExerciseReview,
  CodeLearningLevel,
  ScopedThreadRef,
} from "@t3tools/contracts";
import type { AtomRegistry } from "effect/reactivity";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { resolveStorage } from "./lib/storage";
import { serverEnvironment } from "./state/server";

/**
 * Code leren keeps its exercises on this device: they are practice, not part of the thread's history, and the
 * server only makes and reviews them. One list per thread, newest last.
 */

export interface CodeExerciseEntry {
  readonly exercise: CodeExercise;
  readonly answer: string;
  readonly review: CodeExerciseReview | null;
  readonly attempts: number;
  readonly revealed: boolean;
  readonly hintShown: boolean;
  /** False while the walkthrough is read; the field opens once the learner says they follow it. */
  readonly practising?: boolean;
}

interface ThreadLearning {
  readonly entries: ReadonlyArray<CodeExerciseEntry>;
  /** The exercise the box over the composer shows; null once it was put away. */
  readonly activeId: string | null;
  /** The last run an exercise was made for, so a turn gets at most one. */
  readonly handledRunId: string | null;
}

type Busy = "generating" | "reviewing";

/** Easiest first. Three exercises right at the first try, without a hint, move the learner one level up. */
export const CODE_LEARNING_LEVELS: ReadonlyArray<CodeLearningLevel> = [
  "word",
  "fill",
  "line",
  "block",
];
export const MASTERY_STREAK = 3;

interface CodeLearningState {
  readonly enabled: boolean;
  readonly level: CodeLearningLevel;
  /** Exercises in a row on this level that were right at the first try without a hint. */
  readonly streak: number;
  /** The level just reached by mastering the one before, until the learner has seen it. */
  readonly leveledUpTo: CodeLearningLevel | null;
  readonly byThread: Readonly<Record<string, ThreadLearning>>;
  readonly busy: Readonly<Record<string, Busy>>;
  readonly errors: Readonly<Record<string, string>>;
  setEnabled: (enabled: boolean) => void;
  setLevel: (level: CodeLearningLevel) => void;
  dismissLevelUp: () => void;
}

const MAX_ENTRIES_PER_THREAD = 30;
const EMPTY_THREAD: ThreadLearning = { entries: [], activeId: null, handledRunId: null };

export const useCodeLearningStore = create<CodeLearningState>()(
  persist(
    (set) => ({
      enabled: true,
      level: "word",
      streak: 0,
      leveledUpTo: null,
      byThread: {},
      busy: {},
      errors: {},
      setEnabled: (enabled) => set({ enabled }),
      setLevel: (level) => set({ level, streak: 0, leveledUpTo: null }),
      dismissLevelUp: () => set({ leveledUpTo: null }),
    }),
    {
      name: "t3code:code-learning:v1",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window === "undefined" ? undefined : window.localStorage),
      ),
      version: 1,
      // Version 0 started at filling in part of a line, which was too hard as a first step.
      migrate: (persisted) => ({ ...(persisted as object), level: "word", streak: 0 }),
      partialize: (state) => ({
        enabled: state.enabled,
        level: state.level,
        streak: state.streak,
        leveledUpTo: state.leveledUpTo,
        byThread: state.byThread,
      }),
    },
  ),
);

export function threadLearningOf(state: CodeLearningState, ref: ScopedThreadRef): ThreadLearning {
  return state.byThread[scopedThreadKey(ref)] ?? EMPTY_THREAD;
}

function updateThread(ref: ScopedThreadRef, update: (thread: ThreadLearning) => ThreadLearning) {
  const key = scopedThreadKey(ref);
  useCodeLearningStore.setState((state) => ({
    byThread: { ...state.byThread, [key]: update(state.byThread[key] ?? EMPTY_THREAD) },
  }));
}

function updateEntry(
  ref: ScopedThreadRef,
  exerciseId: string,
  update: (entry: CodeExerciseEntry) => CodeExerciseEntry,
) {
  updateThread(ref, (thread) => ({
    ...thread,
    entries: thread.entries.map((entry) =>
      entry.exercise.id === exerciseId ? update(entry) : entry,
    ),
  }));
}

function setBusy(ref: ScopedThreadRef, busy: Busy | null, error: string | null) {
  const key = scopedThreadKey(ref);
  useCodeLearningStore.setState((state) => {
    const nextBusy = { ...state.busy };
    const nextErrors = { ...state.errors };
    if (busy === null) delete nextBusy[key];
    else nextBusy[key] = busy;
    if (error === null) delete nextErrors[key];
    else nextErrors[key] = error;
    return { busy: nextBusy, errors: nextErrors };
  });
}

function failureMessage(result: AtomCommandResult<unknown, unknown>): string {
  const cause = result._tag === "Failure" ? squashAtomCommandFailure(result) : null;
  return cause instanceof Error && cause.message.length > 0 ? cause.message : "Er ging iets mis.";
}

/**
 * Asks for a new exercise. `quiet` is for the automatic one after a turn: a turn without code then simply has no
 * exercise, instead of an error over the composer.
 */
export async function generateCodeExercise(
  registry: AtomRegistry.AtomRegistry,
  ref: ScopedThreadRef,
  options: { readonly scope: "latest" | "any"; readonly quiet: boolean },
): Promise<void> {
  const state = useCodeLearningStore.getState();
  const key = scopedThreadKey(ref);
  if (state.busy[key] !== undefined) return;
  setBusy(ref, "generating", null);
  const avoid = threadLearningOf(state, ref)
    .entries.slice(-20)
    .map((entry) => entry.exercise.solution.slice(0, 4_000));
  const result = await runAtomCommand(
    registry,
    serverEnvironment.codeLearningRun,
    {
      environmentId: ref.environmentId,
      input: {
        type: "generate",
        threadId: ref.threadId,
        level: state.level,
        scope: options.scope,
        avoid,
      },
    },
    { label: serverEnvironment.codeLearningRun.label, reportFailure: false, reportDefect: true },
  );
  if (result._tag !== "Success" || result.value.type !== "exercise") {
    setBusy(ref, null, options.quiet ? null : failureMessage(result));
    return;
  }
  const exercise = result.value.exercise;
  updateThread(ref, (thread) => ({
    ...thread,
    activeId: exercise.id,
    entries: [
      ...thread.entries,
      {
        exercise,
        answer: "",
        review: null,
        attempts: 0,
        revealed: false,
        hintShown: false,
        practising: (exercise.walkthrough?.length ?? 0) === 0,
      },
    ].slice(-MAX_ENTRIES_PER_THREAD),
  }));
  setBusy(ref, null, null);
}

export async function reviewCodeExercise(
  registry: AtomRegistry.AtomRegistry,
  ref: ScopedThreadRef,
  exerciseId: string,
): Promise<void> {
  const state = useCodeLearningStore.getState();
  const key = scopedThreadKey(ref);
  const entry = threadLearningOf(state, ref).entries.find(
    (candidate) => candidate.exercise.id === exerciseId,
  );
  if (entry === undefined || state.busy[key] !== undefined) return;
  setBusy(ref, "reviewing", null);
  const result = await runAtomCommand(
    registry,
    serverEnvironment.codeLearningRun,
    {
      environmentId: ref.environmentId,
      input: { type: "review", exercise: entry.exercise, answer: entry.answer },
    },
    { label: serverEnvironment.codeLearningRun.label, reportFailure: false, reportDefect: true },
  );
  if (result._tag !== "Success" || result.value.type !== "review") {
    setBusy(ref, null, failureMessage(result));
    return;
  }
  const review = result.value.review;
  updateEntry(ref, exerciseId, (current) => ({
    ...current,
    review,
    attempts: current.attempts + 1,
  }));
  if (review.verdict === "correct") {
    recordMastery(entry.exercise.level, entry.attempts === 0 && !entry.hintShown);
  }
  setBusy(ref, null, null);
}

export function setExerciseAnswer(ref: ScopedThreadRef, exerciseId: string, answer: string) {
  updateEntry(ref, exerciseId, (entry) => ({ ...entry, answer }));
}

export function showExerciseHint(ref: ScopedThreadRef, exerciseId: string) {
  updateEntry(ref, exerciseId, (entry) => ({ ...entry, hintShown: true }));
}

export function revealExercise(ref: ScopedThreadRef, exerciseId: string) {
  const entry = threadLearningOf(useCodeLearningStore.getState(), ref).entries.find(
    (candidate) => candidate.exercise.id === exerciseId,
  );
  updateEntry(ref, exerciseId, (current) => ({ ...current, revealed: true }));
  if (entry) recordMastery(entry.exercise.level, false);
}

export function startPractising(ref: ScopedThreadRef, exerciseId: string) {
  updateEntry(ref, exerciseId, (entry) => ({ ...entry, practising: true }));
}

/**
 * Counts a finished exercise towards mastering the current level. Only exercises made on the current level count,
 * so finishing an old exercise from the history does not move anything.
 */
export function masteryAfter(
  state: { readonly level: CodeLearningLevel; readonly streak: number },
  exerciseLevel: CodeLearningLevel,
  firstTry: boolean,
): { level?: CodeLearningLevel; streak?: number; leveledUpTo?: CodeLearningLevel } {
  if (exerciseLevel !== state.level) return {};
  if (!firstTry) return { streak: 0 };
  const streak = state.streak + 1;
  const next = CODE_LEARNING_LEVELS[CODE_LEARNING_LEVELS.indexOf(state.level) + 1];
  if (streak < MASTERY_STREAK || next === undefined) return { streak };
  return { level: next, streak: 0, leveledUpTo: next };
}

function recordMastery(exerciseLevel: CodeLearningLevel, firstTry: boolean) {
  useCodeLearningStore.setState((state) => masteryAfter(state, exerciseLevel, firstTry));
}

export function setActiveExercise(ref: ScopedThreadRef, exerciseId: string | null) {
  updateThread(ref, (thread) => ({ ...thread, activeId: exerciseId }));
}

/** Records the run so it gets no exercise; returns whether it was new. */
export function claimRunForExercise(ref: ScopedThreadRef, runId: string): boolean {
  const thread = threadLearningOf(useCodeLearningStore.getState(), ref);
  if (thread.handledRunId === runId) return false;
  updateThread(ref, (current) => ({ ...current, handledRunId: runId }));
  return true;
}

export function clearCodeLearningError(ref: ScopedThreadRef) {
  setBusy(ref, useCodeLearningStore.getState().busy[scopedThreadKey(ref)] ?? null, null);
}
