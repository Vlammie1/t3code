import { Buffer } from "node:buffer";

import { describe, expect, it } from "vite-plus/test";

import { clipboardFileCopyCommand } from "./externalLauncher.ts";

describe("clipboardFileCopyCommand", () => {
  it("puts the file itself on the Windows clipboard, quoting the path for PowerShell", () => {
    const launch = clipboardFileCopyCommand(String.raw`C:\Users\dev\it's here.md`, "win32", {
      SYSTEMROOT: String.raw`C:\Windows`,
    });
    expect(launch?.command).toBe(
      String.raw`C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe`,
    );
    const script = Buffer.from(launch?.args.at(-1) ?? "", "base64").toString("utf16le");
    expect(script).toBe(
      String.raw`$ErrorActionPreference = 'Stop'; Set-Clipboard -LiteralPath 'C:\Users\dev\it''s here.md'`,
    );
  });

  it("uses a POSIX file on macOS and is not offered on Linux", () => {
    expect(clipboardFileCopyCommand('/Users/dev/a "b".md', "darwin", {})).toEqual({
      command: "osascript",
      args: ["-e", String.raw`set the clipboard to (POSIX file "/Users/dev/a \"b\".md")`],
    });
    expect(clipboardFileCopyCommand("/home/dev/a.md", "linux", {})).toBeNull();
  });
});
