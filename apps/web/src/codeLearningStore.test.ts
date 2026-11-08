import { describe, expect, it } from "vite-plus/test";

import { masteryAfter } from "./codeLearningStore";

describe("masteryAfter", () => {
  it("moves up a level after three exercises right at the first try", () => {
    expect(masteryAfter({ level: "word", streak: 1 }, "word", true)).toEqual({ streak: 2 });
    expect(masteryAfter({ level: "word", streak: 2 }, "word", true)).toEqual({
      level: "fill",
      streak: 0,
      leveledUpTo: "fill",
    });
  });

  it("starts counting again after a hint, a second try or a shown answer", () => {
    expect(masteryAfter({ level: "fill", streak: 2 }, "fill", false)).toEqual({ streak: 0 });
  });

  it("ignores old exercises from another level and stays on the hardest level", () => {
    expect(masteryAfter({ level: "line", streak: 1 }, "word", true)).toEqual({});
    expect(masteryAfter({ level: "block", streak: 2 }, "block", true)).toEqual({ streak: 3 });
  });
});
