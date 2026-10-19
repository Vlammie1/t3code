import { describe, expect, it } from "vite-plus/test";

import {
  type MarkdownComment,
  mentionsAgent,
  parseCommentedMarkdown,
  serializeCommentedMarkdown,
} from "./markdownComments";

describe("commented markdown", () => {
  const comment: MarkdownComment = {
    id: "c1",
    quote: "sectie volgt",
    author: "You",
    body: "@Claude is this --> right?",
    createdAt: "2026-10-19T10:00:00.000Z",
    replies: [],
  };

  it("round-trips comments through the block at the end of the file", () => {
    const written = serializeCommentedMarkdown("# Plan\n\nText\n", [comment]);
    expect(written.startsWith("# Plan\n\nText\n\n<!-- t3code:comments")).toBe(true);
    // The body text cannot end the HTML comment early.
    expect(written.indexOf("-->")).toBe(written.lastIndexOf("-->"));

    const parsed = parseCommentedMarkdown(written);
    expect(parsed.body).toBe("# Plan\n\nText\n");
    expect(parsed.comments).toEqual([comment]);
    expect(parsed.commentsWritable).toBe(true);
    expect(serializeCommentedMarkdown(parsed.body, [])).toBe("# Plan\n\nText\n");
  });

  it("reads replies an agent added and keeps text written after the block", () => {
    const markdown = [
      "Text",
      "",
      "<!-- t3code:comments",
      "header",
      '[{"id":"c1","quote":"Text","author":"You","body":"Why?","createdAt":"","replies":[{"author":"Claude","body":"Because."}]}]',
      "-->",
      "Appended later",
      "",
    ].join("\n");

    const parsed = parseCommentedMarkdown(markdown);
    expect(parsed.body).toBe("Text\n\nAppended later\n");
    expect(parsed.comments[0]?.replies).toEqual([
      { author: "Claude", body: "Because.", createdAt: "" },
    ]);
  });

  it("refuses to write over a block it cannot read", () => {
    const parsed = parseCommentedMarkdown("Text\n\n<!-- t3code:comments\n[{broken\n-->\n");
    expect(parsed.commentsWritable).toBe(false);
    expect(parsed.body).toBe("Text\n");
  });

  it("recognizes a request to the agent", () => {
    expect(mentionsAgent("@Claude can you check this?")).toBe(true);
    expect(mentionsAgent("thanks @agent")).toBe(true);
    expect(mentionsAgent("mail me@claude.ai")).toBe(false);
    expect(mentionsAgent("Looks good")).toBe(false);
  });
});
