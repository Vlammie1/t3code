import { Suspense, use, type CSSProperties, type ReactNode } from "react";

import { useTheme } from "~/hooks/useTheme";
import { resolveDiffThemeName } from "~/lib/diffRendering";
import { getSyntaxHighlighterPromise } from "~/lib/syntaxHighlighting";
import { keyedLines } from "../chat/HighlightedTokens";

interface Token {
  readonly content: string;
  readonly offset: number;
  readonly color?: string;
  readonly fontStyle?: number;
}

const tokenStyle = (token: Token): CSSProperties => ({
  ...(token.color ? { color: token.color } : {}),
  ...((token.fontStyle ?? 0) & 1 ? { fontStyle: "italic" } : {}),
  ...((token.fontStyle ?? 0) & 2 ? { fontWeight: 700 } : {}),
});

/** Language names a model writes that the highlighter knows under another name. */
const LANGUAGE_ALIASES: Record<string, string> = {
  ts: "typescript",
  js: "javascript",
  py: "python",
  sh: "bash",
  shell: "bash",
  yml: "yaml",
  md: "markdown",
  "c#": "csharp",
  "c++": "cpp",
};

interface ExerciseCodeProps {
  readonly before: string;
  readonly solution: string;
  readonly after: string;
  readonly language: string;
  /** The field to type in; null once the exercise is finished and the solution shows in place. */
  readonly field: ReactNode | null;
  readonly solutionClassName: string;
}

/** The plain text, with the field in its place, while the grammar loads or when it has none. */
function PlainCode(props: ExerciseCodeProps) {
  return (
    <>
      {props.before}
      {props.field ?? <span className={props.solutionClassName}>{props.solution}</span>}
      {props.after}
    </>
  );
}

/**
 * The whole snippet is tokenized at once, solution included, so strings and brackets that run through the hidden
 * part keep their colors around it; the characters of the hidden part are then swapped for the field.
 */
function HighlightedExerciseCode(props: ExerciseCodeProps & { readonly theme: "light" | "dark" }) {
  const language = LANGUAGE_ALIASES[props.language] ?? props.language;
  const highlighter = use(getSyntaxHighlighterPromise(language));
  const code = props.before + props.solution + props.after;
  let lines: ReadonlyArray<ReadonlyArray<Token>>;
  try {
    lines = highlighter.codeToTokens(code, {
      lang: language,
      theme: resolveDiffThemeName(props.theme),
    }).tokens;
  } catch {
    return <PlainCode {...props} />;
  }
  const hiddenStart = props.before.length;
  const hiddenEnd = hiddenStart + props.solution.length;
  const out: ReactNode[] = [];
  let fieldPlaced = false;
  const placeField = () => {
    if (fieldPlaced || props.field === null) return;
    fieldPlaced = true;
    out.push(<span key="field">{props.field}</span>);
  };
  const pushText = (text: string, start: number, token: Token | null) => {
    if (text === "") return;
    const end = start + text.length;
    const pieces: Array<[number, number]> = [
      [start, Math.min(end, hiddenStart)],
      [Math.max(start, hiddenStart), Math.min(end, hiddenEnd)],
      [Math.max(start, hiddenEnd), end],
    ];
    for (const [from, to] of pieces) {
      if (to <= from) continue;
      const piece = code.slice(from, to);
      const hidden = from >= hiddenStart && to <= hiddenEnd && hiddenEnd > hiddenStart;
      if (hidden && props.field !== null) {
        placeField();
        continue;
      }
      out.push(
        <span
          key={from}
          style={token ? tokenStyle(token) : undefined}
          className={hidden ? props.solutionClassName : undefined}
        >
          {piece}
        </span>,
      );
    }
  };
  let lineStart = 0;
  for (const { tokens, ending } of keyedLines(code, lines)) {
    for (const token of tokens) pushText(token.content, token.offset, token);
    const text = tokens.map((token) => token.content).join("");
    pushText(ending, lineStart + text.length, null);
    lineStart += text.length + ending.length;
  }
  // An empty solution or one at the very end still needs its field.
  placeField();
  return <>{out}</>;
}

export function ExerciseCode(props: ExerciseCodeProps) {
  const { resolvedTheme } = useTheme();
  return (
    <Suspense fallback={<PlainCode {...props} />}>
      <HighlightedExerciseCode {...props} theme={resolvedTheme} />
    </Suspense>
  );
}
