import { describe, expect, it } from "vite-plus/test";

import { projectFocusCandidates, resolveThreadFocus } from "./projectFocus.ts";

describe("thread focus", () => {
  const lockspace = { title: "Lockspace", workspaceRoot: "C:/Users/dev/Lockspace" };
  const toetschecker = { title: "toetschecker", workspaceRoot: "C:/Users/dev/toetschecker/" };
  const candidates = projectFocusCandidates(
    {
      context: [
        { path: "C:/Users/dev/lockspace", kind: "directory" },
        { path: "C:/Users/dev/toetschecker", kind: "directory" },
        { path: "C:/Users/dev/boterham", kind: "directory" },
        { path: "C:/Users/dev/notes.md", kind: "file" },
      ],
    },
    [lockspace, toetschecker],
  );

  it("names each context folder after the project that owns it, else the folder", () => {
    expect(candidates).toEqual([
      { name: "Lockspace", path: "C:/Users/dev/lockspace", project: lockspace },
      { name: "toetschecker", path: "C:/Users/dev/toetschecker", project: toetschecker },
      { name: "boterham", path: "C:/Users/dev/boterham", project: null },
    ]);
  });

  it("finds the folder a chat title names first, as a whole word", () => {
    expect(resolveThreadFocus("Moat (Lockspace) iOS: deelscherm", candidates)?.name).toBe(
      "Lockspace",
    );
    expect(resolveThreadFocus("ToetsChecker: abonnementen", candidates)?.name).toBe("toetschecker");
    expect(resolveThreadFocus("Boterham en Lockspace", candidates)?.name).toBe("boterham");
    expect(resolveThreadFocus("Lockspaces overview", candidates)).toBeNull();
    expect(resolveThreadFocus("Coordinator", candidates)).toBeNull();
  });
});
