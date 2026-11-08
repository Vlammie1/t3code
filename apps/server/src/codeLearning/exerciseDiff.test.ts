import { describe, expect, it } from "vite-plus/test";

import {
  addedCodeOf,
  diffContainsCode,
  keepCodeFiles,
  undoOverEscapedCode,
} from "./exerciseDiff.ts";

const sourceFile = `diff --git a/src/sum.ts b/src/sum.ts
index 1111111..2222222 100644
--- a/src/sum.ts
+++ b/src/sum.ts
@@ -1,3 +1,5 @@
 export function sum(values: number[]) {
-  return 0;
+  let total = 0;
+  for (const value of values) total += value;
+  return total;
 }
`;

const lockfile = `diff --git a/pnpm-lock.yaml b/pnpm-lock.yaml
index 3333333..4444444 100644
--- a/pnpm-lock.yaml
+++ b/pnpm-lock.yaml
@@ -1 +1,2 @@
 lockfileVersion: '9.0'
+packages: {}
`;

const deletedFile = `diff --git a/src/old.ts b/src/old.ts
deleted file mode 100644
index 5555555..0000000
--- a/src/old.ts
+++ /dev/null
@@ -1 +0,0 @@
-export const old = 1;
`;

describe("keepCodeFiles", () => {
  it("drops lockfiles and deleted files but keeps source changes", () => {
    const kept = keepCodeFiles(lockfile + sourceFile + deletedFile);
    expect(kept).toBe(sourceFile);
  });

  it("leaves nothing to practise on when only a lockfile changed", () => {
    expect(addedCodeOf(keepCodeFiles(lockfile))).toBe("");
  });
});

describe("diffContainsCode", () => {
  it("finds added code even when the model re-indents it", () => {
    expect(diffContainsCode(sourceFile, "for (const value of values)\n    total += value;")).toBe(
      true,
    );
  });

  it("finds unchanged context lines of the new version", () => {
    expect(diffContainsCode(sourceFile, "export function sum(values: number[])")).toBe(true);
  });

  it("rejects removed code and code that is not in the diff", () => {
    expect(diffContainsCode(sourceFile, "return 0;")).toBe(false);
    expect(diffContainsCode(sourceFile, "values.reduce((a, b) => a + b, 0)")).toBe(false);
    expect(diffContainsCode(sourceFile, "   ")).toBe(false);
  });
});

describe("undoOverEscapedCode", () => {
  it("turns escaped line breaks and doubled backslashes back into code", () => {
    const fixed = undoOverEscapedCode({
      before: 'const slashed = value.replaceAll("\\\\\\\\", "/");\\n  return windows ? ',
      solution: "slashed.toLowerCase()",
      after: " : slashed;\\n}",
    });
    expect(fixed.before).toBe(
      'const slashed = value.replaceAll("\\\\", "/");\n  return windows ? ',
    );
    expect(fixed.after).toBe(" : slashed;\n}");
  });

  it("leaves code with real line breaks alone, including a backslash-n inside a string", () => {
    const fields = { before: 'const line = "a\\nb";\n', solution: "x", after: "\n}" };
    expect(undoOverEscapedCode(fields)).toBe(fields);
  });
});
