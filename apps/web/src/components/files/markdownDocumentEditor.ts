import { Highlight } from "@tiptap/extension-highlight";
import { Image } from "@tiptap/extension-image";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";

/** The document editor's schema; every node and mark here reads and writes markdown. */
export function markdownDocumentExtensions() {
  return [
    StarterKit.configure({
      link: { openOnClick: false, autolink: true, defaultProtocol: "https" },
      trailingNode: false,
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    Highlight,
    Image,
    Markdown.configure({ markedOptions: { gfm: true } }),
  ];
}

// Characters whose spelling the editor may change without changing the content:
// list markers, emphasis markers, escapes, table pipes and alignment, headings.
const MARKDOWN_SYNTAX_PATTERN = /[\s\\|\-*_+#>`~:]/g;

/**
 * Whether the editor's markdown for a document says the same as the file: only
 * whitespace and syntax spelling may differ. Raw HTML the editor drops, such as
 * an anchor, makes this false.
 */
export function keepsMarkdownContent(original: string, written: string): boolean {
  return (
    original.replace(MARKDOWN_SYNTAX_PATTERN, "") === written.replace(MARKDOWN_SYNTAX_PATTERN, "")
  );
}
