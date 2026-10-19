import { resolveExtensions } from "@tiptap/core";
import { MarkdownManager } from "@tiptap/markdown";
import { describe, expect, it } from "vite-plus/test";

import { markdownDocumentExtensions } from "./markdownDocumentEditor";

function roundTrip(markdown: string): string {
  const manager = new MarkdownManager({
    extensions: resolveExtensions(markdownDocumentExtensions()),
    markedOptions: { gfm: true },
  });
  return manager.serialize(manager.parse(markdown));
}

describe("markdown document editor", () => {
  it("writes back the markdown a plan document is made of", () => {
    const markdown = [
      "# Marketingplan ToetsChecker",
      "",
      "## In het kort",
      "",
      "De groeimotor is de **docent**, niet de *schoolleider*: een `docent` begint [gratis](https://toetschecker.nl).",
      "",
      "- Doelgroep is het voortgezet onderwijs.",
      "- Wie een pilot aanvraagt verschilt per school.",
      "  - Nested punt",
      "",
      "1. Eerst",
      "2. Dan",
      "",
      "- [ ] Open taak",
      "- [x] Klaar",
      "",
      "> Een citaat",
      "",
      "| Kanaal | Doel |",
      "| --- | --- |",
      "| LinkedIn | Bereik |",
      "",
      "```ts",
      "const a = 1;",
      "```",
      "",
      "---",
      "",
      "Laatste regel met ~~doorgehaald~~ en ==gemarkeerd==.",
    ].join("\n");

    const output = roundTrip(markdown);
    expect(output).toContain("# Marketingplan ToetsChecker");
    expect(output).toContain("**docent**");
    expect(output).toContain("[gratis](https://toetschecker.nl)");
    expect(output).toContain("- [x] Klaar");
    expect(output).toContain("| LinkedIn");
    expect(output).toContain("```ts\nconst a = 1;\n```");
    expect(output).toContain("~~doorgehaald~~");
    expect(output).toContain("==gemarkeerd==");
    // A second save writes the same text, so the file does not drift with each edit.
    expect(roundTrip(output)).toBe(output);
  });
});
