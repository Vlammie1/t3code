import type { RoerActivityEntry } from "@t3tools/contracts";

/** One row of a Roer job as `/t3/thread/:id/wolk` returns it. Its event shape belongs to Roer, so it is read loosely. */
export interface RoerRegel {
  readonly volgnr: number;
  readonly tijd: string;
  readonly gebeurtenis: { readonly [key: string]: unknown };
}

const MAX_LABEL = 300;

const text = (value: unknown) => (typeof value === "string" ? value : "");
const count = (value: unknown) =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
const short = (value: string) =>
  value.length > MAX_LABEL ? `${value.slice(0, MAX_LABEL - 1)}…` : value;

const inputOf = (value: unknown): { readonly [key: string]: unknown } =>
  value !== null && typeof value === "object" ? (value as { readonly [key: string]: unknown }) : {};

const fileOf = (input: { readonly [key: string]: unknown }) =>
  text(input.file_path) || text(input.notebook_path) || text(input.path) || null;

// Claude Code's own tool input names, which Roer passes through as they are.
const labelOf = (input: { readonly [key: string]: unknown }) =>
  short(
    text(input.command) ||
      fileOf(input) ||
      text(input.pattern) ||
      text(input.query) ||
      text(input.url) ||
      text(input.description) ||
      text(input.prompt),
  );

const sameEntry = (left: RoerActivityEntry, right: RoerActivityEntry) =>
  left.seq === right.seq &&
  left.at === right.at &&
  left.kind === right.kind &&
  left.text === right.text &&
  left.live === right.live &&
  left.tool?.name === right.tool?.name &&
  left.tool?.failed === right.tool?.failed &&
  left.tool?.file === right.tool?.file &&
  left.tool?.additions === right.tool?.additions &&
  left.tool?.deletions === right.tool?.deletions;

/**
 * Folds rows from Roer into the entries the chat shows and returns the ones that changed. Rows come again when they
 * change (a growing text keeps its number), and a tool's start and end are two rows; both land on one entry.
 * Work inside a subagent stays out, as it does for a subagent's steps in a thread here.
 */
export function applyRoerRegels(
  entries: Map<string, RoerActivityEntry>,
  regels: ReadonlyArray<RoerRegel>,
): RoerActivityEntry[] {
  const changed = new Map<string, RoerActivityEntry>();
  const put = (fresh: RoerActivityEntry) => {
    const previous = entries.get(fresh.id);
    // Roer stamps a row again each time it changes; the chat places an entry by when it began.
    const entry = previous === undefined ? fresh : { ...fresh, at: previous.at };
    if (previous !== undefined && sameEntry(previous, entry)) return;
    entries.set(entry.id, entry);
    changed.set(entry.id, entry);
  };
  for (const regel of regels) {
    const event = regel.gebeurtenis;
    const id = String(regel.volgnr);
    const base = { id, seq: regel.volgnr, at: regel.tijd, live: false, tool: null };
    const body = text(event.tekst);
    switch (event.soort) {
      case "gebruiker":
        if (body) put({ ...base, kind: "user", text: body });
        break;
      case "tekst":
        if (body && !event.binnen)
          put({ ...base, kind: "assistant", text: body, live: event.klaar !== true });
        break;
      case "denken":
        if (body) put({ ...base, kind: "reasoning", text: body, live: event.klaar !== true });
        break;
      case "stap_begin": {
        if (event.binnen) break;
        const stepId = `step:${text(event.id)}`;
        const previous = entries.get(stepId);
        const input = inputOf(event.invoer);
        put({
          ...base,
          id: stepId,
          kind: "tool",
          text: labelOf(input),
          // A start that comes again after its end must not make the tool look like it runs again.
          live: previous?.live ?? true,
          tool: {
            name: text(event.gereedschap) || "Tool",
            failed: previous?.tool?.failed ?? false,
            file: fileOf(input),
            additions: previous?.tool?.additions ?? null,
            deletions: previous?.tool?.deletions ?? null,
          },
        });
        break;
      }
      case "stap_eind": {
        const previous = entries.get(`step:${text(event.id)}`);
        if (previous?.tool == null) break;
        const diff = inputOf(event.diff);
        put({
          ...previous,
          live: false,
          tool: {
            ...previous.tool,
            failed: event.status !== "ok",
            file: previous.tool.file ?? (text(diff.bestand) || null),
            additions: count(diff.plus),
            deletions: count(diff.min),
          },
        });
        break;
      }
      case "melding":
        // The move itself is the only notice worth a line of its own; its progress notes are not.
        if (event.naar === "server") put({ ...base, kind: "notice", text: "Moved to the cloud" });
        else if (event.naar === "laptop")
          put({ ...base, kind: "notice", text: "Back on this machine" });
        else if (body && !body.startsWith("Verplaatsen naar"))
          put({ ...base, kind: "notice", text: body });
        break;
      case "fout":
        if (body) put({ ...base, kind: "error", text: body });
        break;
      case "klaar":
        if (event.fout === true) put({ ...base, kind: "error", text: body || "The turn failed." });
        else if (event.onderbroken === true) put({ ...base, kind: "notice", text: "Interrupted" });
        break;
      case "vraag": {
        const answer = text(event.antwoord);
        put({
          ...base,
          kind: "notice",
          text: answer ? `${text(event.vraag)}\nAnswer: ${answer}` : text(event.vraag),
        });
        break;
      }
      case "limiet":
        if (body) put({ ...base, kind: "notice", text: body });
        break;
      case "pr": {
        const number = count(event.nummer);
        if (number !== null) put({ ...base, kind: "notice", text: `Pull request #${number}` });
        break;
      }
    }
  }
  return [...changed.values()].sort((left, right) => left.seq - right.seq);
}
