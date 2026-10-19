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
