/** Files a beginner learns nothing from: lockfiles, build output, snapshots and minified or binary content. */
const SKIPPED_PATH =
  /(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|bun\.lockb?|Cargo\.lock|poetry\.lock|composer\.lock|Gemfile\.lock)$|(^|\/)(dist|build|out|node_modules|\.next|coverage)\/|\.(min\.(js|css)|map|snap|lock|png|jpe?g|gif|webp|ico|pdf|zip|woff2?|ttf)$/i;

function fileSections(diff: string): string[] {
  return diff.split(/^(?=diff --git )/m).filter((section) => section.startsWith("diff --git "));
}

function sectionPath(section: string): string {
  const header = section.slice(0, section.indexOf("\n"));
  return header.match(/ b\/(.+)$/)?.[1] ?? "";
}

/** The diff without files that make poor exercises, such as lockfiles, deletions and binaries. */
export function keepCodeFiles(diff: string): string {
  return fileSections(diff)
    .filter((section) => {
      if (SKIPPED_PATH.test(sectionPath(section))) return false;
      if (/^deleted file mode /m.test(section) || /^Binary files /m.test(section)) return false;
      return true;
    })
    .join("");
}

/**
 * The changed files with the most new code, up to `maxChars`. One file is enough for an exercise, and a big turn
 * otherwise sends the model tens of thousands of characters it only skims, which mostly costs waiting time.
 */
export function focusDiff(diff: string, maxChars: number): string {
  const ranked = fileSections(diff)
    .map((section) => ({ section, added: addedCodeOf(section).length }))
    .filter((file) => file.added > 0)
    .toSorted((left, right) => right.added - left.added);
  let focused = "";
  for (const { section } of ranked) {
    if (focused.length === 0) focused = section.slice(0, maxChars);
    else if (focused.length + section.length <= maxChars) focused += section;
  }
  return focused;
}

/** Every added line of the diff, without its `+` marker. */
export function addedCodeOf(diff: string): string {
  return diff
    .split("\n")
    .filter((line) => line.startsWith("+") && !line.startsWith("+++"))
    .map((line) => line.slice(1))
    .join("\n");
}

const withoutWhitespace = (value: string) => value.replace(/\s+/g, "");

/**
 * Whether `code` is in the new version of a changed file. Whitespace is ignored because models re-indent what they
 * copy, which is no reason to throw a good exercise away.
 */
export function diffContainsCode(diff: string, code: string): boolean {
  const needle = withoutWhitespace(code);
  if (needle.length === 0) return false;
  return fileSections(diff).some((section) => {
    const newVersion = section
      .split("\n")
      .filter((line) => (line.startsWith("+") && !line.startsWith("+++")) || line.startsWith(" "))
      .map((line) => line.slice(1))
      .join("\n");
    return withoutWhitespace(newVersion).includes(needle);
  });
}

/**
 * Some models escape the code in their JSON once too often: every line break arrives as a backslash and an `n`, and
 * every backslash twice. A block of code without a single real line break but with those pairs is undone one level.
 */
export function undoOverEscapedCode<T extends { before: string; solution: string; after: string }>(
  fields: T,
): T {
  const context = fields.before + fields.after;
  if (context.includes("\n") || !context.includes("\\n")) return fields;
  const undo = (value: string) =>
    value.replace(/\\(\\|n|t|r)/g, (_match, escaped: string) =>
      escaped === "n" ? "\n" : escaped === "t" ? "\t" : escaped === "r" ? "" : "\\",
    );
  return {
    ...fields,
    before: undo(fields.before),
    solution: undo(fields.solution),
    after: undo(fields.after),
  };
}
