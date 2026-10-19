export interface MarkdownBlock {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

const FENCE_PATTERN = /^ {0,3}(`{3,}|~{3,})/;
const INDENTED_PATTERN = /^(?: {2,}|\t)\S/;

/**
 * Splits a document into the units the rendered view edits in place: runs of
 * lines between blank lines. Fenced code and HTML comments stay whole, and an
 * indented run stays with the block above it, since it continues a list item
 * or code. The text between blocks is left untouched, so replacing one block
 * leaves every other byte of the file as it was.
 */
export function splitMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  let blockStart: number | null = null;
  let blockEnd = 0;
  let fence: string | null = null;
  let inHtmlComment = false;
  let offset = 0;

  const close = () => {
    if (blockStart === null) return;
    blocks.push({ start: blockStart, end: blockEnd, text: markdown.slice(blockStart, blockEnd) });
    blockStart = null;
  };

  while (offset <= markdown.length) {
    const newline = markdown.indexOf("\n", offset);
    const lineEnd = newline === -1 ? markdown.length : newline;
    const line = markdown.slice(offset, lineEnd).replace(/\r$/, "");
    const contentEnd = offset + line.length;
    const blank = line.trim() === "";

    if (fence !== null || inHtmlComment) {
      blockEnd = contentEnd;
      if (fence !== null && line.trimStart().startsWith(fence)) fence = null;
      if (inHtmlComment && line.includes("-->")) inHtmlComment = false;
    } else if (blank) {
      close();
    } else {
      const previous = blocks.at(-1);
      if (blockStart === null && previous && INDENTED_PATTERN.test(line)) {
        blocks.pop();
        blockStart = previous.start;
      }
      blockStart ??= offset;
      blockEnd = contentEnd;
      const fenceMatch = FENCE_PATTERN.exec(line);
      if (fenceMatch?.[1]) {
        const marker = fenceMatch[1];
        if (!line.slice(line.indexOf(marker) + marker.length).includes(marker[0]!)) {
          fence = marker;
        }
      }
      const commentOpen = line.lastIndexOf("<!--");
      if (commentOpen !== -1 && !line.slice(commentOpen).includes("-->")) inHtmlComment = true;
    }

    if (newline === -1) break;
    offset = newline + 1;
  }
  close();
  return blocks;
}

export function replaceMarkdownBlock(
  markdown: string,
  block: Pick<MarkdownBlock, "start" | "end">,
  text: string,
): string {
  const trimmed = text.replace(/\s+$/, "");
  if (trimmed.trim() !== "") {
    return `${markdown.slice(0, block.start)}${trimmed}${markdown.slice(block.end)}`;
  }
  // An emptied block takes the blank lines after it along, so no gap grows.
  const after = markdown.slice(block.end).replace(/^(?:\r?\n)+/, "");
  const before = markdown.slice(0, block.start);
  return after === "" ? `${before.replace(/(?:\r?\n)+$/, "")}\n` : `${before}${after}`;
}

export function appendMarkdownBlock(markdown: string, text: string): string {
  const trimmed = text.replace(/\s+$/, "");
  if (trimmed.trim() === "") return markdown;
  const body = markdown.replace(/\s+$/, "");
  return body === "" ? `${trimmed}\n` : `${body}\n\n${trimmed}\n`;
}
