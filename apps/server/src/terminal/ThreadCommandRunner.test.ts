import { describe, expect, it } from "vite-plus/test";

import { failedCommandMessage } from "./ThreadCommandRunner.ts";

describe("failedCommandMessage", () => {
  it("hands the agent the command, its exit code and what it printed", () => {
    expect(
      failedCommandMessage({
        command: "npm test",
        exitCode: 1,
        output: ["FAIL src/app.test.ts", "1 failed"],
      }),
    ).toBe(
      [
        "I ran this command from the chat and it failed with exit code 1:",
        "",
        "```shell",
        "$ npm test",
        "FAIL src/app.test.ts",
        "1 failed",
        "```",
      ].join("\n"),
    );
  });
});
