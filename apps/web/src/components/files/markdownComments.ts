/**
 * Comments on a markdown document live in the file itself, in one HTML comment
 * at the end. Every agent that reads the file sees them without a tool, an
 * agent answers by editing the JSON, and a rendered view (GitHub included)
 * hides the block.
 */

export interface MarkdownCommentReply {
  readonly author: string;
  readonly body: string;
  readonly createdAt: string;
}

export interface MarkdownComment extends MarkdownCommentReply {
  readonly id: string;
  /** The commented text as the reader saw it, whitespace collapsed. */
  readonly quote: string;
  readonly replies: ReadonlyArray<MarkdownCommentReply>;
}

export interface CommentedMarkdown {
  /** The document without the comments block. */
  readonly body: string;
  readonly comments: ReadonlyArray<MarkdownComment>;
  /**
   * False when a comments block exists but does not parse. Writing comments
   * then would replace whatever the block held, so the view stays read-only for them.
   */
  readonly commentsWritable: boolean;
}

const BLOCK_PATTERN = /(?:\r?\n)*<!--\s*t3code:comments\b[\s\S]*?-->[ \t]*(?:\r?\n)?/;

const BLOCK_HEADER = [
  "<!-- t3code:comments",
  'Review comments on this document, as JSON. Keep this block when you edit the file. To answer a comment, add {"author", "body", "createdAt"} to its "replies"; the document itself is edited above this block.',
].join("\n");

const isString = (value: unknown): value is string => typeof value === "string";

function readReply(value: unknown): MarkdownCommentReply | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (!isString(record.body)) return null;
  return {
    author: isString(record.author) && record.author.trim() !== "" ? record.author : "Agent",
    body: record.body,
    createdAt: isString(record.createdAt) ? record.createdAt : "",
  };
}

function readComment(value: unknown): MarkdownComment | null {
  const base = readReply(value);
  if (base === null) return null;
  const record = value as Record<string, unknown>;
  if (!isString(record.id) || !isString(record.quote)) return null;
  const replies = Array.isArray(record.replies)
    ? record.replies.flatMap((reply) => {
        const parsed = readReply(reply);
        return parsed === null ? [] : [parsed];
      })
    : [];
  return { ...base, id: record.id, quote: record.quote, replies };
}

export function parseCommentedMarkdown(markdown: string): CommentedMarkdown {
  const match = BLOCK_PATTERN.exec(markdown);
  if (!match) return { body: markdown, comments: [], commentsWritable: true };
  const before = markdown.slice(0, match.index);
  const after = markdown.slice(match.index + match[0].length);
  const body = after === "" ? `${before}\n` : `${before}\n\n${after}`;
  const block = match[0];
  const json = block.slice(block.indexOf("["), block.lastIndexOf("]") + 1);
  try {
    const parsed: unknown = JSON.parse(json);
    if (!Array.isArray(parsed)) throw new Error("Not a list");
    const comments = parsed.flatMap((entry) => {
      const comment = readComment(entry);
      return comment === null ? [] : [comment];
    });
    return { body, comments, commentsWritable: true };
  } catch {
    return { body, comments: [], commentsWritable: false };
  }
}

/** `>` is escaped so no comment text can close the HTML comment early. */
export function serializeCommentedMarkdown(
  body: string,
  comments: ReadonlyArray<MarkdownComment>,
): string {
  const document = body.replace(/\s+$/, "");
  if (comments.length === 0) return `${document}\n`;
  const json = JSON.stringify(comments, null, 2).replaceAll(">", "\\u003e");
  return `${document}\n\n${BLOCK_HEADER}\n${json}\n-->\n`;
}

/** Matches whether the text addresses the thread's agent, as `@Claude` or `@agent`. */
export function mentionsAgent(text: string): boolean {
  return /(?:^|\s)@(?:claude|agent|codex)\b/i.test(text);
}

export function normalizeCommentQuote(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

let commentSequence = 0;

export function nextMarkdownCommentId(now = Date.now()): string {
  commentSequence += 1;
  return `c${now.toString(36)}${commentSequence.toString(36)}`;
}

export function agentCommentRequest(input: {
  readonly path: string;
  readonly comment: MarkdownComment;
  readonly message: string;
}): string {
  return [
    `I commented on \`${input.path}\` and want your answer there.`,
    "",
    `> ${input.comment.quote}`,
    "",
    input.message,
    "",
    `Reply in the comments block at the end of that file: add {"author": "<your name>", "body": "<your answer>", "createdAt": "<ISO time>"} to the "replies" of the comment with id "${input.comment.id}". If the comment asks for a change to the document, make it in the document too.`,
  ].join("\n");
}
