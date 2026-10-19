export const WORKSPACE_BASENAME_LOOKUP_LIMIT = 25;

// One counter for every caller: they all open the same panel, so the newest
// click wins regardless of which one started the lookup.
let latestLookupSequence = 0;

export function claimWorkspaceBasenameLookup(): () => boolean {
  latestLookupSequence += 1;
  const claimed = latestLookupSequence;
  return () => claimed === latestLookupSequence;
}

export interface WorkspaceEntryCandidate {
  readonly path: string;
  readonly kind: "file" | "directory";
}

function basenameOfPath(path: string): string {
  const separatorIndex = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return separatorIndex >= 0 ? path.slice(separatorIndex + 1) : path;
}

export function needsWorkspaceBasenameLookup(relativePath: string): boolean {
  const trimmed = relativePath.trim();
  return (
    trimmed !== "." &&
    trimmed !== ".." &&
    trimmed.length > 0 &&
    !trimmed.includes("/") &&
    !trimmed.includes("\\")
  );
}

export function pickWorkspaceBasenameMatch(
  basename: string,
  entries: ReadonlyArray<WorkspaceEntryCandidate>,
): string | null {
  const target = basename.trim();
  if (!target) return null;
  const files = entries.filter((entry) => entry.kind === "file");
  const exact = files.find((entry) => basenameOfPath(entry.path) === target);
  if (exact) return exact.path;
  const folded = target.toLowerCase();
  const foldedMatches = files.filter(
    (entry) => basenameOfPath(entry.path).toLowerCase() === folded,
  );
  return foldedMatches.length === 1 ? (foldedMatches[0]?.path ?? null) : null;
}

/**
 * An agent that worked in a subfolder links paths relative to that folder, so
 * `docs/plan.md` can mean `app/docs/plan.md`. Only a single file ending in the
 * whole requested path counts; two candidates leave the link as it was.
 */
export function pickWorkspaceSuffixMatch(
  relativePath: string,
  entries: ReadonlyArray<WorkspaceEntryCandidate>,
): string | null {
  const target = relativePath.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  if (!target.includes("/") || target.startsWith("../")) return null;
  const files = entries.filter((entry) => entry.kind === "file");
  const matchesOf = (fold: (value: string) => string) =>
    files.filter((entry) => fold(entry.path).endsWith(`/${fold(target)}`));
  const exact = matchesOf((value) => value);
  if (exact.length > 0) return exact.length === 1 ? (exact[0]?.path ?? null) : null;
  const folded = matchesOf((value) => value.toLowerCase());
  return folded.length === 1 ? (folded[0]?.path ?? null) : null;
}
