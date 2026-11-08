import { RegistryContext } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { CodeLearningLevel, ScopedThreadRef } from "@t3tools/contracts";
import { useContext, type KeyboardEvent } from "react";

import {
  BookOpenIcon,
  CheckIcon,
  EyeIcon,
  LightbulbIcon,
  RefreshCwIcon,
} from "~/components/appIcons";
import {
  CODE_LEARNING_LEVELS,
  generateCodeExercise,
  revealExercise,
  startPractising,
  reviewCodeExercise,
  setExerciseAnswer,
  showExerciseHint,
  type CodeExerciseEntry,
  useCodeLearningStore,
} from "~/codeLearningStore";
import { cn } from "~/lib/utils";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { ExerciseCode } from "./ExerciseCode";

export const LEVEL_LABELS: Record<CodeLearningLevel, string> = {
  word: "Eén woord",
  fill: "Stukje regel",
  line: "Een regel",
  block: "Een blok",
};

const VERDICT_STYLES = {
  correct: { label: "Goed!", className: "bg-success/8 text-success-foreground" },
  almost: { label: "Bijna", className: "bg-warning/8 text-warning-foreground" },
  wrong: { label: "Nog niet", className: "bg-destructive/8 text-destructive-foreground" },
} as const;

/** The file name for the header, with the folder in front kept short. */
function fileLabel(path: string) {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return { folder: slash === -1 ? "" : path.slice(0, slash + 1), name: path.slice(slash + 1) };
}

function useThreadBusy(threadRef: ScopedThreadRef) {
  const key = scopedThreadKey(threadRef);
  return useCodeLearningStore((state) => state.busy[key] ?? null);
}

/**
 * One exercise: the code around the hidden part, a field where the hidden part goes, and the review. The same view
 * sits over the composer and in the Code leren panel, so practice looks the same wherever it is.
 */
export function CodeExerciseView(props: {
  readonly threadRef: ScopedThreadRef;
  readonly entry: CodeExerciseEntry;
  /** Over the composer the code scrolls in a short window; the panel lets it grow. */
  readonly compact: boolean;
}) {
  const { threadRef, entry, compact } = props;
  const { exercise } = entry;
  const registry = useContext(RegistryContext);
  const busy = useThreadBusy(threadRef);
  const solved = entry.review?.verdict === "correct";
  const finished = solved || entry.revealed;
  const walkthrough = exercise.walkthrough ?? [];
  const explaining = !finished && entry.practising === false && walkthrough.length > 0;
  const canSubmit = busy === null && !finished && entry.answer.trim().length > 0;
  const file = fileLabel(exercise.filePath);
  const verdict = entry.review ? VERDICT_STYLES[entry.review.verdict] : null;

  const submit = () => {
    if (canSubmit) void reviewCodeExercise(registry, threadRef, exercise.id);
  };
  const onFieldKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const isTextarea = event.currentTarget.tagName === "TEXTAREA";
    if (event.key !== "Enter" || (isTextarea && !(event.metaKey || event.ctrlKey))) return;
    event.preventDefault();
    submit();
  };
  const onAnswer = (answer: string) => setExerciseAnswer(threadRef, exercise.id, answer);

  const field = finished ? null : explaining ? (
    <span
      aria-label="Het lege stuk"
      style={{ width: `${Math.max(exercise.solution.length + 3, 6)}ch` }}
      className="inline-block rounded-sm border border-dashed border-primary/50 bg-primary/10 align-bottom"
    >
      {" "}
    </span>
  ) : exercise.level === "fill" || exercise.level === "word" ? (
    <input
      aria-label="Jouw code voor het lege stuk"
      value={entry.answer}
      onChange={(event) => onAnswer(event.target.value)}
      onKeyDown={onFieldKeyDown}
      spellCheck={false}
      autoComplete="off"
      // Room for the answer plus a little, so the length is a hint without giving it away exactly.
      style={{ width: `${Math.max(exercise.solution.length + 3, 8)}ch` }}
      className="rounded-sm bg-primary/10 px-1 text-foreground outline-none ring-1 ring-inset ring-primary/40 focus:ring-2 focus:ring-inset focus:ring-primary"
    />
  ) : (
    <textarea
      aria-label="Jouw code voor het lege stuk"
      value={entry.answer}
      onChange={(event) => onAnswer(event.target.value)}
      onKeyDown={onFieldKeyDown}
      spellCheck={false}
      autoComplete="off"
      rows={Math.max(exercise.solution.split("\n").length, 1)}
      placeholder={exercise.level === "line" ? "Typ hier de regel" : "Typ hier de regels"}
      className="block w-full resize-y rounded-md bg-primary/10 px-1.5 py-1 text-foreground outline-none ring-1 ring-inset ring-primary/40 placeholder:text-muted-foreground/70 focus:ring-2 focus:ring-inset focus:ring-primary"
    />
  );

  const code = (
    <pre className="min-w-max px-3 py-2 font-mono text-xs/5 text-foreground/75">
      <ExerciseCode
        before={exercise.before}
        solution={exercise.solution}
        after={exercise.after}
        language={exercise.language}
        field={field}
        solutionClassName="rounded-sm bg-success/16"
      />
    </pre>
  );

  return (
    <div className="flex min-w-0 flex-col gap-2 text-xs/5">
      <LevelUpNotice />
      <p className="text-foreground">{exercise.summary}</p>
      <div className="flex min-w-0 flex-col overflow-hidden rounded-xl bg-foreground/5">
        <div className="flex min-w-0 items-center gap-2 px-3 pt-2 pb-1">
          <span className="min-w-0 truncate font-mono text-2xs">
            <span className="text-muted-foreground">{file.folder}</span>
            <span className="text-foreground">{file.name}</span>
          </span>
          <span className="ms-auto shrink-0 text-2xs text-muted-foreground">
            {exercise.language} · {LEVEL_LABELS[exercise.level]}
          </span>
        </div>
        <ScrollArea
          scrollFade
          className={cn("h-auto", compact ? "max-h-[min(15rem,32dvh)]" : "max-h-[60dvh]")}
        >
          {code}
        </ScrollArea>
      </div>
      {explaining ? (
        <ScrollArea
          scrollFade
          className={cn("h-auto", compact ? "max-h-[min(14rem,30dvh)]" : "max-h-none")}
        >
          <ol className="flex flex-col gap-1.5">
            {walkthrough.map((step, index) => (
              // Steps are fixed once made and only ever shown in this order.
              // oxlint-disable-next-line react/no-array-index-key
              <li key={index} className="flex gap-2">
                <span className="w-4 shrink-0 text-end text-muted-foreground tabular-nums">
                  {index + 1}.
                </span>
                <span className="flex min-w-0 flex-col">
                  {step.code ? (
                    <code className="min-w-0 truncate font-mono text-2xs text-muted-foreground">
                      {step.code}
                    </code>
                  ) : (
                    <span className="text-2xs text-primary">Het lege stuk</span>
                  )}
                  <span className="text-foreground">{step.explanation}</span>
                </span>
              </li>
            ))}
          </ol>
        </ScrollArea>
      ) : (
        <p className="text-foreground">
          <span className="font-medium">Opdracht: </span>
          {exercise.task}
        </p>
      )}
      {entry.hintShown && !finished ? (
        <p className="flex gap-1.5 text-muted-foreground">
          <LightbulbIcon className="mt-0.5 size-3.5 shrink-0" />
          {exercise.hint}
        </p>
      ) : null}
      {entry.review && verdict ? (
        <div className={cn("rounded-xl px-3 py-2", verdict.className)}>
          <p className="font-medium">{verdict.label}</p>
          <p className="text-foreground">{entry.review.feedback}</p>
          {entry.review.tip ? <p className="text-foreground">{entry.review.tip}</p> : null}
        </div>
      ) : null}
      {finished ? <p className="text-muted-foreground">{exercise.explanation}</p> : null}
      <div className="flex flex-wrap items-center gap-1">
        {explaining ? (
          <Button size="xs" onClick={() => startPractising(threadRef, exercise.id)}>
            <CheckIcon />
            Ik snap het, nu invullen
          </Button>
        ) : null}
        {finished || explaining ? null : (
          <Button size="xs" disabled={!canSubmit} onClick={submit}>
            <CheckIcon />
            {busy === "reviewing" ? "Nakijken…" : "Nakijken"}
          </Button>
        )}
        {finished || explaining || entry.hintShown ? null : (
          <Button
            size="xs"
            variant="ghost"
            onClick={() => showExerciseHint(threadRef, exercise.id)}
          >
            <LightbulbIcon />
            Hint
          </Button>
        )}
        {finished || explaining ? null : (
          <Button size="xs" variant="ghost" onClick={() => revealExercise(threadRef, exercise.id)}>
            <EyeIcon />
            Antwoord tonen
          </Button>
        )}
        <Button
          size="xs"
          variant={finished ? "default" : "ghost"}
          disabled={busy !== null}
          onClick={() =>
            void generateCodeExercise(registry, threadRef, { scope: "any", quiet: false })
          }
        >
          <RefreshCwIcon />
          {busy === "generating" ? "Oefening maken…" : "Nieuwe oefening"}
        </Button>
      </div>
    </div>
  );
}

/** What shows before there is an exercise, or while the first one is made. */
export function CodeLearningEmpty(props: { readonly threadRef: ScopedThreadRef }) {
  const registry = useContext(RegistryContext);
  const busy = useThreadBusy(props.threadRef);
  return (
    <div className="flex flex-col items-start gap-2 text-xs/5 text-muted-foreground">
      <span className="flex items-center gap-1.5 text-foreground">
        <BookOpenIcon className="size-3.5" />
        Nog geen oefening in deze chat.
      </span>
      <Button
        size="xs"
        disabled={busy !== null}
        onClick={() =>
          void generateCodeExercise(registry, props.threadRef, { scope: "any", quiet: false })
        }
      >
        <RefreshCwIcon />
        {busy === "generating" ? "Oefening maken…" : "Maak een oefening"}
      </Button>
    </div>
  );
}

/** Shown once after the learner mastered a level, wherever the next exercise appears. */
function LevelUpNotice() {
  const leveledUpTo = useCodeLearningStore((state) => state.leveledUpTo);
  if (leveledUpTo === null) return null;
  const previous = CODE_LEARNING_LEVELS[CODE_LEARNING_LEVELS.indexOf(leveledUpTo) - 1];
  return (
    <div className="flex items-center gap-2 rounded-xl bg-success/8 px-3 py-2 text-success-foreground">
      <CheckIcon className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1">
        {previous ? `${LEVEL_LABELS[previous]} beheers je. ` : ""}
        Vanaf nu: {LEVEL_LABELS[leveledUpTo].toLowerCase()}.
      </span>
      <Button
        size="xs"
        variant="ghost"
        onClick={() => useCodeLearningStore.getState().dismissLevelUp()}
      >
        Oké
      </Button>
    </div>
  );
}
