import { RegistryContext } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ThreadRunSummary } from "@t3tools/client-runtime/state/shell";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useContext, useEffect } from "react";

import { BookOpenIcon, PanelRightIcon, XIcon } from "~/components/appIcons";
import {
  CODE_LEARNING_LEVELS,
  MASTERY_STREAK,
  claimRunForExercise,
  clearCodeLearningError,
  generateCodeExercise,
  setActiveExercise,
  threadLearningOf,
  useCodeLearningStore,
  type CodeExerciseEntry,
} from "~/codeLearningStore";
import { cn } from "~/lib/utils";
import { useRightPanelStore } from "~/rightPanelStore";
import { ComposerBanner } from "../chat/ComposerBanner";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { Switch } from "../ui/switch";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { CodeExerciseView, CodeLearningEmpty, LEVEL_LABELS } from "./CodeExercise";

/** A turn that finished longer ago than this was not just watched; opening its thread later makes no exercise. */
const RECENT_TURN_MS = 10 * 60_000;

/**
 * Makes an exercise when a turn of this thread finishes with code changes. Mount it once where the thread is shown.
 */
export function useCodeLearningAfterTurn(
  threadRef: ScopedThreadRef | null,
  latestRun: ThreadRunSummary | null,
  settled: boolean,
) {
  const registry = useContext(RegistryContext);
  const enabled = useCodeLearningStore((state) => state.enabled);
  const runId = latestRun?.runId ?? null;
  const completedAt = latestRun?.status === "completed" ? latestRun.completedAt : null;
  useEffect(() => {
    if (!enabled || threadRef === null || !settled || runId === null || completedAt === null) {
      return;
    }
    if (Date.now() - Date.parse(completedAt) > RECENT_TURN_MS) return;
    if (!claimRunForExercise(threadRef, runId)) return;
    void generateCodeExercise(registry, threadRef, { scope: "latest", quiet: true });
  }, [registry, enabled, threadRef, settled, runId, completedAt]);
}

function useThreadLearning(threadRef: ScopedThreadRef) {
  const key = scopedThreadKey(threadRef);
  const thread = useCodeLearningStore((state) => threadLearningOf(state, threadRef));
  const busy = useCodeLearningStore((state) => state.busy[key] ?? null);
  const error = useCodeLearningStore((state) => state.errors[key] ?? null);
  return { thread, busy, error };
}

/** The exercise over the composer, until it is put away or the panel shows it instead. */
export function CodeLearningComposerBox(props: { readonly threadRef: ScopedThreadRef }) {
  const { threadRef } = props;
  const { thread, busy, error } = useThreadLearning(threadRef);
  const panelShowsLearning = useRightPanelStore((state) => {
    const panel = state.byThreadKey[scopedThreadKey(threadRef)];
    return panel?.isOpen === true && panel.activeSurfaceId === "learn";
  });
  const active = thread.entries.find((entry) => entry.exercise.id === thread.activeId) ?? null;
  if (panelShowsLearning) return null;

  if (active === null) {
    if (busy === "generating") {
      return (
        <ComposerBanner.Attachment>
          <ComposerBanner.Root>
            <ComposerBanner.Row>
              <ComposerBanner.Icon>
                <Spinner />
              </ComposerBanner.Icon>
              <ComposerBanner.Content>
                Oefening maken over wat er net is gebouwd…
              </ComposerBanner.Content>
            </ComposerBanner.Row>
          </ComposerBanner.Root>
        </ComposerBanner.Attachment>
      );
    }
    if (error === null) return null;
    return (
      <ComposerBanner.Attachment>
        <ComposerBanner.Root variant="warning">
          <ComposerBanner.Row>
            <ComposerBanner.Icon>
              <BookOpenIcon />
            </ComposerBanner.Icon>
            <ComposerBanner.Content>{error}</ComposerBanner.Content>
            <ComposerBanner.Actions>
              <ComposerBanner.Dismiss
                aria-label="Melding sluiten"
                onClick={() => clearCodeLearningError(threadRef)}
              />
            </ComposerBanner.Actions>
          </ComposerBanner.Row>
        </ComposerBanner.Root>
      </ComposerBanner.Attachment>
    );
  }

  return (
    <ComposerBanner.Attachment>
      <ComposerBanner.Root>
        <ComposerBanner.Row>
          <ComposerBanner.Icon>
            <BookOpenIcon />
          </ComposerBanner.Icon>
          <ComposerBanner.Content className="font-medium text-foreground">
            Code leren
          </ComposerBanner.Content>
          <ComposerBanner.Actions>
            <Button
              size="icon-xs"
              variant="ghost"
              aria-label="Openen in het paneel"
              onClick={() => useRightPanelStore.getState().open(threadRef, "learn")}
            >
              <PanelRightIcon />
            </Button>
            <ComposerBanner.Dismiss
              aria-label="Oefening wegleggen"
              onClick={() => setActiveExercise(threadRef, null)}
            >
              <XIcon className="size-3.5" />
            </ComposerBanner.Dismiss>
          </ComposerBanner.Actions>
        </ComposerBanner.Row>
        <div className="px-2 pt-1 pb-2">
          <CodeExerciseView threadRef={threadRef} entry={active} compact />
          {error ? <p className="pt-2 text-xs text-destructive-foreground">{error}</p> : null}
        </div>
      </ComposerBanner.Root>
    </ComposerBanner.Attachment>
  );
}

const VERDICT_DOT = {
  correct: "bg-success",
  almost: "bg-warning",
  wrong: "bg-destructive",
} as const;

function HistoryRow(props: {
  readonly entry: CodeExerciseEntry;
  readonly selected: boolean;
  readonly onSelect: () => void;
}) {
  const { exercise, review, revealed } = props.entry;
  const name = exercise.filePath.slice(
    Math.max(exercise.filePath.lastIndexOf("/"), exercise.filePath.lastIndexOf("\\")) + 1,
  );
  const dot = review ? VERDICT_DOT[review.verdict] : revealed ? "bg-muted-foreground" : null;
  return (
    <button
      type="button"
      onClick={props.onSelect}
      className={cn(
        "flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-start text-xs hover:bg-foreground/5",
        props.selected && "bg-foreground/5",
      )}
    >
      <span
        className={cn("size-1.5 shrink-0 rounded-full", dot ?? "border border-muted-foreground")}
      />
      <span className="min-w-0 flex-1 truncate text-foreground">{exercise.task}</span>
      <span className="shrink-0 font-mono text-2xs text-muted-foreground">{name}</span>
    </button>
  );
}

/** Code leren in the right panel: the settings, the current exercise and the ones before it. */
export function CodeLearningPanel(props: { readonly threadRef: ScopedThreadRef }) {
  const { threadRef } = props;
  const { thread, busy, error } = useThreadLearning(threadRef);
  const enabled = useCodeLearningStore((state) => state.enabled);
  const level = useCodeLearningStore((state) => state.level);
  const streak = useCodeLearningStore((state) => state.streak);
  const shown =
    thread.entries.find((entry) => entry.exercise.id === thread.activeId) ??
    thread.entries.at(-1) ??
    null;
  const history = thread.entries.toReversed();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <div className="flex flex-col gap-3 border-b border-border/60 px-4 py-3">
        <div className="flex items-center gap-2">
          <BookOpenIcon className="size-4 text-muted-foreground" />
          <h2 className="font-medium text-sm">Code leren</h2>
        </div>
        <ToggleGroup
          aria-label="Hoeveel code je zelf schrijft"
          className="w-full *:flex-1"
          value={[level]}
          onValueChange={(next) => {
            const value = CODE_LEARNING_LEVELS.find((candidate) => candidate === next[0]);
            if (value !== undefined) useCodeLearningStore.getState().setLevel(value);
          }}
        >
          {CODE_LEARNING_LEVELS.map((value) => (
            <Toggle key={value} value={value}>
              {LEVEL_LABELS[value]}
            </Toggle>
          ))}
        </ToggleGroup>
        {level === CODE_LEARNING_LEVELS.at(-1) ? null : (
          <p className="text-xs text-muted-foreground">
            <span className="text-foreground tabular-nums">
              {streak} van {MASTERY_STREAK}
            </span>{" "}
            in één keer goed, zonder hint. Dan ga je vanzelf een niveau omhoog.
          </p>
        )}
        <label className="flex items-center justify-between gap-3 text-xs text-foreground">
          Na elke beurt een oefening
          <Switch
            size="sm"
            checked={enabled}
            onCheckedChange={(checked) => useCodeLearningStore.getState().setEnabled(checked)}
          />
        </label>
      </div>
      <div className="flex flex-col gap-3 px-4 py-3">
        {shown === null ? (
          <CodeLearningEmpty threadRef={threadRef} />
        ) : (
          <CodeExerciseView
            key={shown.exercise.id}
            threadRef={threadRef}
            entry={shown}
            compact={false}
          />
        )}
        {busy === "generating" && shown !== null ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Spinner className="size-3.5" />
            Oefening maken…
          </p>
        ) : null}
        {error ? <p className="text-xs text-destructive-foreground">{error}</p> : null}
      </div>
      {history.length > 1 ? (
        <div className="flex flex-col gap-1 border-t border-border/60 px-2.5 py-3">
          <h3 className="px-1.5 pb-1 text-xs text-muted-foreground">Eerdere oefeningen</h3>
          {history.map((entry) => (
            <HistoryRow
              key={entry.exercise.id}
              entry={entry}
              selected={entry.exercise.id === shown?.exercise.id}
              onSelect={() => setActiveExercise(threadRef, entry.exercise.id)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
