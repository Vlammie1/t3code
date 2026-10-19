import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import {
  ArrowUpIcon,
  BoldIcon,
  CheckIcon,
  ChevronDownIcon,
  Code2,
  CommentAddIcon,
  HighlighterIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  ListTodoIcon,
  StrikethroughIcon,
  UnderlineIcon,
} from "~/components/appIcons";
import { RelativeTime } from "~/components/RelativeTime";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "~/components/ui/menu";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Textarea } from "~/components/ui/textarea";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useStableCallback } from "~/hooks/useStableCallback";
import { observeResize } from "~/lib/observeResize";
import { cn, newMessageId } from "~/lib/utils";
import { useThreadShell } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";

import { markdownDocumentExtensions } from "./markdownDocumentEditor";
import {
  type MarkdownComment,
  agentCommentRequest,
  mentionsAgent,
  nextMarkdownCommentId,
  normalizeCommentQuote,
  parseCommentedMarkdown,
  serializeCommentedMarkdown,
} from "./markdownComments";
import {
  getOptimisticProjectFileQueryData,
  setProjectFileQueryData,
} from "./projectFilesQueryState";
import { useFileSaveCoordinator } from "./useFileSaveCoordinator";

const COMMENT_HIGHLIGHT = "t3-markdown-comment";
const ACTIVE_COMMENT_HIGHLIGHT = "t3-markdown-comment-active";
/** Below this width the comments move from the margin to under the document. */
const MARGIN_LAYOUT_MIN_WIDTH = 900;
const CARD_GAP_PX = 8;
const SAVE_DELAY_MS = 300;
const TOOLBAR_WIDTH_PX = 440;
const POPOVER_WIDTH_PX = 360;
const USER_AUTHOR = "You";

// CSS highlights are one registry per page, and several documents can be open
// in split panels, so each surface contributes its ranges to a shared set.
const highlightsBySurface = new Map<
  object,
  { readonly all: ReadonlyArray<Range>; readonly active: ReadonlyArray<Range> }
>();

function paintHighlights() {
  if (typeof CSS === "undefined" || !("highlights" in CSS) || typeof Highlight === "undefined") {
    return;
  }
  const entries = [...highlightsBySurface.values()];
  CSS.highlights.set(COMMENT_HIGHLIGHT, new Highlight(...entries.flatMap((entry) => entry.all)));
  CSS.highlights.set(
    ACTIVE_COMMENT_HIGHLIGHT,
    new Highlight(...entries.flatMap((entry) => entry.active)),
  );
}

interface TextIndex {
  readonly text: string;
  readonly nodes: ReadonlyArray<Text>;
  readonly nodeIndex: ReadonlyArray<number>;
  readonly offsets: ReadonlyArray<number>;
}

/** The rendered text with whitespace collapsed, mapped back to DOM positions. */
function buildTextIndex(root: HTMLElement): TextIndex {
  const nodes: Text[] = [];
  const nodeIndex: number[] = [];
  const offsets: number[] = [];
  let text = "";
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const textNode = node as Text;
    const value = textNode.data;
    nodes.push(textNode);
    for (let offset = 0; offset < value.length; offset += 1) {
      if (/\s/.test(value[offset]!)) {
        if (text === "" || text.endsWith(" ")) continue;
        text += " ";
      } else {
        text += value[offset];
      }
      nodeIndex.push(nodes.length - 1);
      offsets.push(offset);
    }
    // Block boundaries separate words even where the DOM has no whitespace.
    if (text !== "" && !text.endsWith(" ")) {
      text += " ";
      nodeIndex.push(nodes.length - 1);
      offsets.push(value.length);
    }
  }
  return { text, nodes, nodeIndex, offsets };
}

function rangeForQuote(index: TextIndex, quote: string): Range | null {
  if (quote === "") return null;
  const start = index.text.indexOf(quote);
  if (start === -1) return null;
  const end = start + quote.length - 1;
  const range = document.createRange();
  range.setStart(index.nodes[index.nodeIndex[start]!]!, index.offsets[start]!);
  const endNode = index.nodes[index.nodeIndex[end]!]!;
  range.setEnd(endNode, Math.min(index.offsets[end]! + 1, endNode.data.length));
  return range;
}

function caretFromPoint(x: number, y: number): { node: Node; offset: number } | null {
  const position = document.caretPositionFromPoint?.(x, y);
  if (position) return { node: position.offsetNode, offset: position.offset };
  const range = document.caretRangeFromPoint?.(x, y);
  return range ? { node: range.startContainer, offset: range.startOffset } : null;
}

function ToolbarButton(props: {
  readonly label: string;
  readonly active?: boolean;
  readonly onPress: () => void;
  readonly children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={props.label}
            aria-pressed={props.active}
            data-pressed={props.active ? "" : undefined}
            onClick={props.onPress}
          >
            {props.children}
          </Button>
        }
      />
      <TooltipPopup>{props.label}</TooltipPopup>
    </Tooltip>
  );
}

function ToolbarDivider() {
  return <span aria-hidden className="mx-0.5 h-5 w-px shrink-0 bg-border" />;
}

const TEXT_STYLES = [
  { label: "Text", level: null },
  { label: "Heading 1", level: 1 },
  { label: "Heading 2", level: 2 },
  { label: "Heading 3", level: 3 },
] as const;

function SelectionToolbar(props: { readonly editor: Editor; readonly onComment: () => void }) {
  const { editor } = props;
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      underline: current.isActive("underline"),
      strike: current.isActive("strike"),
      code: current.isActive("code"),
      highlight: current.isActive("highlight"),
      link: current.isActive("link"),
      href: (current.getAttributes("link").href as string | undefined) ?? "",
      headingLevel: ([1, 2, 3] as const).find((level) => current.isActive("heading", { level })),
    }),
  });
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const chain = () => editor.chain().focus();
  const applyLink = () => {
    const href = linkDraft?.trim() ?? "";
    if (href === "") chain().extendMarkRange("link").unsetLink().run();
    else chain().extendMarkRange("link").setLink({ href }).run();
    setLinkDraft(null);
  };

  if (linkDraft !== null) {
    return (
      <div className="flex items-center gap-1 p-1">
        <input
          autoFocus
          value={linkDraft}
          placeholder="Paste a link"
          aria-label="Link address"
          className="h-7 w-64 rounded-lg bg-transparent px-2 text-sm text-foreground outline-none placeholder:text-muted-foreground"
          onChange={(event) => setLinkDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              applyLink();
            } else if (event.key === "Escape") {
              event.preventDefault();
              setLinkDraft(null);
              editor.commands.focus();
            }
          }}
        />
        <Button size="xs" onClick={applyLink}>
          {linkDraft.trim() === "" && state.link ? "Remove" : "Apply"}
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-0.5 p-1">
      <ToolbarButton label="Comment" onPress={props.onComment}>
        <CommentAddIcon className="size-4" />
      </ToolbarButton>
      <ToolbarDivider />
      <Menu>
        <MenuTrigger
          render={
            <Button variant="ghost" size="sm" aria-label="Text style">
              <span className="font-medium">Aa</span>
              <ChevronDownIcon className="size-3" />
            </Button>
          }
        />
        <MenuPopup align="start">
          {TEXT_STYLES.map((style) => (
            <MenuItem
              key={style.label}
              onClick={() => {
                if (style.level === null) chain().setParagraph().run();
                else chain().setHeading({ level: style.level }).run();
              }}
            >
              <span className="flex-1">{style.label}</span>
              {(state.headingLevel ?? null) === style.level ? (
                <CheckIcon className="size-3.5" />
              ) : null}
            </MenuItem>
          ))}
        </MenuPopup>
      </Menu>
      <ToolbarButton label="Bold" active={state.bold} onPress={() => chain().toggleBold().run()}>
        <BoldIcon className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Italic"
        active={state.italic}
        onPress={() => chain().toggleItalic().run()}
      >
        <ItalicIcon className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Underline"
        active={state.underline}
        onPress={() => chain().toggleUnderline().run()}
      >
        <UnderlineIcon className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Strikethrough"
        active={state.strike}
        onPress={() => chain().toggleStrike().run()}
      >
        <StrikethroughIcon className="size-4" />
      </ToolbarButton>
      <ToolbarButton label="Code" active={state.code} onPress={() => chain().toggleCode().run()}>
        <Code2 className="size-4" />
      </ToolbarButton>
      <ToolbarButton
        label="Highlight"
        active={state.highlight}
        onPress={() => chain().toggleHighlight().run()}
      >
        <HighlighterIcon className="size-4" />
      </ToolbarButton>
      <ToolbarDivider />
      <Menu>
        <MenuTrigger
          render={
            <Button variant="ghost" size="sm" aria-label="List">
              <ListIcon className="size-4" />
              <ChevronDownIcon className="size-3" />
            </Button>
          }
        />
        <MenuPopup align="start">
          <MenuItem onClick={() => chain().toggleBulletList().run()}>
            <ListIcon className="size-4" />
            Bulleted list
          </MenuItem>
          <MenuItem onClick={() => chain().toggleOrderedList().run()}>
            <ListOrderedIcon className="size-4" />
            Numbered list
          </MenuItem>
          <MenuItem onClick={() => chain().toggleTaskList().run()}>
            <ListTodoIcon className="size-4" />
            Checklist
          </MenuItem>
        </MenuPopup>
      </Menu>
      <ToolbarDivider />
      <ToolbarButton label="Link" active={state.link} onPress={() => setLinkDraft(state.href)}>
        <LinkIcon className="size-4" />
      </ToolbarButton>
    </div>
  );
}

function CommentComposer(props: {
  readonly placeholder: string;
  readonly agentName: string | null;
  readonly defaultSendToAgent: boolean;
  readonly autoFocus: boolean;
  readonly onSubmit: (text: string, sendToAgent: boolean) => void;
  readonly onCancel?: () => void;
}) {
  const [text, setText] = useState("");
  const [sendToAgent, setSendToAgent] = useState(props.defaultSendToAgent);
  const submit = () => {
    const trimmed = text.trim();
    if (trimmed === "") return;
    props.onSubmit(trimmed, sendToAgent && props.agentName !== null);
    setText("");
  };
  return (
    <div className="flex flex-col gap-2">
      <Textarea
        size="sm"
        value={text}
        autoFocus={props.autoFocus}
        placeholder={props.placeholder}
        aria-label={props.placeholder}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit();
          } else if (event.key === "Escape" && props.onCancel) {
            event.preventDefault();
            props.onCancel();
          }
        }}
      />
      <div className="flex items-center gap-2">
        {props.agentName !== null ? (
          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <Checkbox
              checked={sendToAgent}
              onCheckedChange={(checked) => setSendToAgent(checked === true)}
            />
            Send to {props.agentName}
          </label>
        ) : (
          <span className="flex-1" />
        )}
        {props.onCancel ? (
          <Button variant="ghost" size="xs" onClick={props.onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button
          size="icon-xs"
          aria-label="Send comment"
          disabled={text.trim() === ""}
          onClick={submit}
        >
          <ArrowUpIcon />
        </Button>
      </div>
    </div>
  );
}

function CommentEntry(props: {
  readonly author: string;
  readonly body: string;
  readonly createdAt: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline gap-1.5 text-xs">
        <span className="font-medium text-foreground">{props.author}</span>
        {props.createdAt ? (
          <span className="text-muted-foreground">
            <RelativeTime timestamp={props.createdAt} />
          </span>
        ) : null}
      </div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{props.body}</p>
    </div>
  );
}

function CommentCard(props: {
  readonly ref: (element: HTMLDivElement | null) => void;
  readonly comment: MarkdownComment;
  readonly active: boolean;
  readonly anchored: boolean;
  readonly writable: boolean;
  readonly floating: boolean;
  readonly agentName: string | null;
  readonly onActivate: () => void;
  readonly onReply: (text: string, sendToAgent: boolean) => void;
  readonly onResolve: () => void;
}) {
  const { comment, ref } = props;
  return (
    <div
      ref={ref}
      data-markdown-comment={comment.id}
      className={cn(
        "flex flex-col gap-3 rounded-2xl bg-popover p-3 shadow-xs ring-1 ring-border/70 transition-[top,box-shadow] duration-200 ease-out",
        props.floating && "absolute inset-x-0",
        props.active && "shadow-md ring-foreground/20",
      )}
      onClick={props.onActivate}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {props.anchored ? null : (
            <p className="mb-1 text-2xs text-muted-foreground">No longer in the document</p>
          )}
          <p
            className={cn(
              "line-clamp-3 border-s-2 ps-2 text-xs leading-relaxed text-muted-foreground",
              props.anchored ? "border-warning/60" : "border-border",
            )}
          >
            {comment.quote}
          </p>
        </div>
        {props.writable ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost-muted"
                  size="icon-xs"
                  aria-label="Resolve comment"
                  onClick={(event) => {
                    event.stopPropagation();
                    props.onResolve();
                  }}
                >
                  <CheckIcon className="size-3.5" />
                </Button>
              }
            />
            <TooltipPopup>Resolve</TooltipPopup>
          </Tooltip>
        ) : null}
      </div>
      <CommentEntry author={comment.author} body={comment.body} createdAt={comment.createdAt} />
      {comment.replies.map((reply) => (
        <CommentEntry
          key={`${reply.createdAt}:${reply.author}:${reply.body}`}
          author={reply.author}
          body={reply.body}
          createdAt={reply.createdAt}
        />
      ))}
      {props.active && props.writable ? (
        <CommentComposer
          placeholder="Reply"
          agentName={props.agentName}
          defaultSendToAgent={false}
          autoFocus={false}
          onSubmit={props.onReply}
        />
      ) : null}
    </div>
  );
}

interface SelectionAnchor {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
}

interface CommentDraft {
  readonly quote: string;
  readonly anchor: SelectionAnchor;
}

export function MarkdownDocumentSurface(props: {
  readonly environmentId: EnvironmentId;
  readonly cwd: string;
  readonly relativePath: string;
  readonly contents: string;
  readonly threadRef: ScopedThreadRef;
  /** A draft has no thread yet, so there is no agent to ask. */
  readonly draft: boolean;
  readonly readOnly: boolean;
  readonly onPendingChange: (relativePath: string, pending: boolean) => void;
}) {
  const { environmentId, cwd, relativePath, contents, threadRef } = props;
  const saveCoordinator = useFileSaveCoordinator({
    environmentId,
    cwd,
    relativePath,
    onPendingChange: props.onPendingChange,
  });
  const threadShell = useThreadShell(props.draft ? null : threadRef);
  const startThreadTurn = useOrchestrationCommand(threadEnvironment.startTurn, {
    reportFailure: false,
  });
  const parsed = parseCommentedMarkdown(contents);
  // An unreadable comments block would be lost on the next write, so it locks the document.
  const editable = !props.readOnly && parsed.commentsWritable;
  const agentName = threadShell
    ? /claude/i.test(threadShell.providerInstanceId)
      ? "Claude"
      : "the agent"
    : null;

  const [selectionAnchor, setSelectionAnchor] = useState<SelectionAnchor | null>(null);
  const [commentDraft, setCommentDraft] = useState<CommentDraft | null>(null);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [marginLayout, setMarginLayout] = useState(false);
  const [layoutWidth, setLayoutWidth] = useState(0);
  const [surfaceKey] = useState(() => ({}));
  const [anchoredIds, setAnchoredIds] = useState<ReadonlySet<string>>(new Set());

  const scrollRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const rangesRef = useRef(new Map<string, Range>());
  /** The body the editor holds, so a file change that only echoes our own save is ignored. */
  const editorBodyRef = useRef(parsed.body);
  const saveTimerRef = useRef<number | null>(null);

  const currentContents = () =>
    getOptimisticProjectFileQueryData(environmentId, cwd, relativePath)?.contents ?? contents;
  const writeContents = (next: string) => {
    if (next === currentContents()) return;
    setProjectFileQueryData(environmentId, cwd, relativePath, next);
    saveCoordinator.change(next);
  };
  const updateComments = (
    transform: (comments: ReadonlyArray<MarkdownComment>) => ReadonlyArray<MarkdownComment>,
  ) => {
    const current = parseCommentedMarkdown(currentContents());
    if (!current.commentsWritable) return;
    writeContents(serializeCommentedMarkdown(current.body, transform(current.comments)));
  };

  // Editor callbacks are registered once, at creation, so they read the editor through a ref.
  const editorRef = useRef<Editor | null>(null);
  const anchorFor = (from: number, to: number): SelectionAnchor | null => {
    const current = editorRef.current;
    const layout = layoutRef.current;
    if (!current || !layout) return null;
    const origin = layout.getBoundingClientRect();
    const start = current.view.coordsAtPos(from);
    const end = current.view.coordsAtPos(to);
    return {
      top: start.top - origin.top,
      bottom: end.bottom - origin.top,
      left: Math.max(0, start.left - origin.left),
    };
  };
  const flushSave = useStableCallback(() => {
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    const current = editorRef.current;
    if (!current || current.isDestroyed) return;
    const body = current.getMarkdown();
    const file = parseCommentedMarkdown(currentContents());
    if (!file.commentsWritable) return;
    editorBodyRef.current = body;
    const hadBlock = file.comments.length > 0 || file.body !== currentContents();
    writeContents(
      hadBlock ? serializeCommentedMarkdown(body, file.comments) : `${body.trimEnd()}\n`,
    );
  });
  const scheduleSave = useStableCallback(() => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(flushSave, SAVE_DELAY_MS);
  });
  const readSelection = useStableCallback(() => {
    const current = editorRef.current;
    if (!current) return;
    const { from, to, empty } = current.state.selection;
    if (empty || !current.isFocused) {
      setSelectionAnchor(null);
      return;
    }
    setSelectionAnchor(anchorFor(from, to));
  });
  const startComment = useStableCallback(() => {
    const current = editorRef.current;
    if (!current || !editable) return;
    const { from, to, empty } = current.state.selection;
    if (empty) return;
    const quote = normalizeCommentQuote(current.state.doc.textBetween(from, to, " ", " "));
    const anchor = anchorFor(from, to);
    if (quote === "" || !anchor) return;
    setCommentDraft({ quote, anchor });
    setActiveCommentId(null);
    setSelectionAnchor(null);
  });

  const editor = useEditor(
    {
      extensions: markdownDocumentExtensions(),
      content: parsed.body,
      contentType: "markdown",
      editable,
      editorProps: {
        attributes: {
          class: "chat-markdown markdown-document-editor",
          spellcheck: "true",
          "aria-label": relativePath,
        },
        handleKeyDown: (_view, event) => {
          if ((event.metaKey || event.ctrlKey) && event.altKey && event.code === "KeyM") {
            event.preventDefault();
            startComment();
            return true;
          }
          return false;
        },
        handleClick: (_view, _position, event) => {
          const link = (event.target as HTMLElement).closest("a[href]");
          if (link && (event.metaKey || event.ctrlKey)) {
            window.open(link.getAttribute("href") ?? "", "_blank", "noopener");
            return true;
          }
          return false;
        },
      },
      onCreate: ({ editor: created }) => {
        editorRef.current = created;
      },
      onUpdate: () => scheduleSave(),
      onSelectionUpdate: () => readSelection(),
      onBlur: ({ event }) => {
        // The toolbar and its menus take focus; only a blur elsewhere hides it.
        const next = event.relatedTarget as HTMLElement | null;
        if (next?.closest("[data-markdown-toolbar], [data-slot=menu-popup]")) return;
        setSelectionAnchor(null);
      },
    },
    [],
  );
  useLayoutEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // Typing that has not reached its save yet is written before the surface goes.
  useEffect(
    () => () => {
      if (saveTimerRef.current !== null) flushSave();
    },
    [flushSave],
  );

  // A change from elsewhere, such as an agent editing the file, replaces the
  // editor's text unless it only echoes what the editor saved.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    if (parsed.body.trimEnd() === editorBodyRef.current.trimEnd()) return;
    if (saveTimerRef.current !== null) return;
    editorBodyRef.current = parsed.body;
    editor.commands.setContent(parsed.body, { contentType: "markdown", emitUpdate: false });
  }, [editor, parsed.body]);

  useEffect(() => {
    if (editor && !editor.isDestroyed) editor.setEditable(editable);
  }, [editor, editable]);

  const askAgent = (comment: MarkdownComment, message: string) => {
    if (!threadShell) {
      toastManager.add(
        stackedThreadToast({
          type: "info",
          title: "Send a first message in this chat",
          description: "The comment is saved. Ask the agent again once the chat has started.",
        }),
      );
      return;
    }
    void startThreadTurn({
      environmentId,
      input: {
        threadId: threadRef.threadId,
        message: {
          messageId: newMessageId(),
          role: "user",
          text: agentCommentRequest({ path: relativePath, comment, message }),
          attachments: [],
        },
        runtimeMode: threadShell.runtimeMode,
        interactionMode: threadShell.interactionMode,
        dispatchMode: "auto",
        createdAt: new Date().toISOString(),
      },
    }).then((result) => {
      if (result._tag === "Success" || isAtomCommandInterrupted(result)) return;
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not send the comment to the agent",
          description: "The comment is saved in the file.",
        }),
      );
    });
  };

  const submitComment = (body: string, sendToAgent: boolean) => {
    if (!commentDraft) return;
    flushSave();
    const comment: MarkdownComment = {
      id: nextMarkdownCommentId(),
      quote: commentDraft.quote,
      author: USER_AUTHOR,
      body,
      createdAt: new Date().toISOString(),
      replies: [],
    };
    updateComments((comments) => [...comments, comment]);
    setCommentDraft(null);
    setActiveCommentId(comment.id);
    if (sendToAgent || mentionsAgent(body)) askAgent(comment, body);
  };

  const replyToComment = (comment: MarkdownComment, body: string, sendToAgent: boolean) => {
    flushSave();
    const reply = { author: USER_AUTHOR, body, createdAt: new Date().toISOString() };
    updateComments((comments) =>
      comments.map((entry) =>
        entry.id === comment.id ? { ...entry, replies: [...entry.replies, reply] } : entry,
      ),
    );
    if (sendToAgent || mentionsAgent(body)) askAgent(comment, body);
  };

  const commentAtPoint = (x: number, y: number): string | null => {
    const caret = caretFromPoint(x, y);
    if (!caret) return null;
    for (const [id, range] of rangesRef.current) {
      try {
        if (range.isPointInRange(caret.node, caret.offset)) return id;
      } catch {
        // A range from an earlier render can point at detached nodes.
      }
    }
    return null;
  };

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    return observeResize(element, (entries) => {
      const entry = entries.at(-1);
      if (entry) setMarginLayout(entry.contentRect.width >= MARGIN_LAYOUT_MIN_WIDTH);
    });
  }, []);

  useEffect(() => {
    const element = layoutRef.current;
    if (!element) return;
    return observeResize(element, (entries) => {
      const entry = entries.at(-1);
      if (entry) setLayoutWidth(entry.contentRect.width);
    });
  }, []);

  useEffect(
    () => () => {
      highlightsBySurface.delete(surfaceKey);
      paintHighlights();
    },
    [surfaceKey],
  );

  // Anchors highlights to the rendered text and lines the margin cards up with
  // them; reruns on every render and whenever the document reflows.
  const layoutComments = useStableCallback(() => {
    const root = documentRef.current;
    if (!root) return;
    const index = buildTextIndex(root);
    const ranges = new Map<string, Range>();
    for (const comment of parsed.comments) {
      const range = rangeForQuote(index, normalizeCommentQuote(comment.quote));
      if (range) ranges.set(comment.id, range);
    }
    const draftRange = commentDraft ? rangeForQuote(index, commentDraft.quote) : null;
    rangesRef.current = ranges;
    const activeRange = activeCommentId ? ranges.get(activeCommentId) : undefined;
    highlightsBySurface.set(surfaceKey, {
      all: [...ranges.values()],
      active: [activeRange, draftRange].filter((range): range is Range => range != null),
    });
    paintHighlights();

    const nextAnchored = new Set(ranges.keys());
    if (
      nextAnchored.size !== anchoredIds.size ||
      [...nextAnchored].some((id) => !anchoredIds.has(id))
    ) {
      setAnchoredIds(nextAnchored);
    }

    const rail = railRef.current;
    if (!marginLayout || !rail) return;
    const railTop = rail.getBoundingClientRect().top;
    const placements: Array<{ element: HTMLElement; top: number }> = [];
    for (const comment of parsed.comments) {
      const element = cardRefs.current.get(comment.id);
      if (!element) continue;
      const range = ranges.get(comment.id);
      placements.push({
        element,
        top: range ? range.getBoundingClientRect().top - railTop : Number.POSITIVE_INFINITY,
      });
    }
    placements.sort((left, right) => left.top - right.top);
    let bottom = 0;
    for (const placement of placements) {
      const top = Number.isFinite(placement.top) ? Math.max(placement.top, bottom) : bottom;
      placement.element.style.top = `${top}px`;
      bottom = top + placement.element.offsetHeight + CARD_GAP_PX;
    }
    rail.style.minHeight = `${bottom}px`;
  });

  useLayoutEffect(() => {
    layoutComments();
  });

  useEffect(() => {
    const element = documentRef.current;
    if (!element) return;
    return observeResize(element, () => layoutComments());
  }, [layoutComments]);

  const setCardRef = (id: string) => (element: HTMLDivElement | null) => {
    if (element) cardRefs.current.set(id, element);
    else cardRefs.current.delete(id);
  };

  const cards = parsed.comments.map((comment) => (
    <CommentCard
      key={comment.id}
      ref={setCardRef(comment.id)}
      comment={comment}
      active={activeCommentId === comment.id}
      anchored={anchoredIds.has(comment.id)}
      writable={editable}
      floating={marginLayout}
      agentName={agentName}
      onActivate={() => setActiveCommentId(comment.id)}
      onReply={(text, sendToAgent) => replyToComment(comment, text, sendToAgent)}
      onResolve={() => {
        updateComments((entries) => entries.filter((entry) => entry.id !== comment.id));
        if (activeCommentId === comment.id) setActiveCommentId(null);
      }}
    />
  ));

  const popoverLeft = (anchor: SelectionAnchor, width: number) =>
    Math.max(8, Math.min(anchor.left, layoutWidth - width - 8));

  return (
    <ScrollArea ref={scrollRef} className="min-h-0 flex-1">
      <div
        ref={layoutRef}
        className={cn(
          "relative mx-auto flex w-full gap-12 px-6 pt-14 pb-32 sm:px-12",
          marginLayout ? "max-w-[66rem]" : "max-w-[48rem] flex-col",
        )}
      >
        <div className="min-w-0 flex-1">
          {!parsed.commentsWritable ? (
            <p className="mb-6 rounded-xl bg-warning-surface px-3 py-2 text-xs text-warning-foreground">
              The comments block at the end of this file cannot be read. Fix it in the source view
              to comment or edit here.
            </p>
          ) : null}
          <div
            ref={documentRef}
            className="markdown-document"
            onClick={(event) => {
              const id = commentAtPoint(event.clientX, event.clientY);
              if (id !== null) setActiveCommentId(id);
            }}
          >
            <EditorContent editor={editor} />
          </div>
          {!marginLayout && cards.length > 0 ? (
            <section className="mt-16 flex flex-col gap-3">
              <h2 className="text-xs font-medium text-muted-foreground">Comments</h2>
              {cards}
            </section>
          ) : null}
        </div>
        {marginLayout ? (
          <div ref={railRef} className="relative w-72 shrink-0">
            {cards}
          </div>
        ) : null}

        {selectionAnchor && editor && editable && !commentDraft ? (
          <div
            data-markdown-toolbar
            className="absolute z-20 rounded-xl bg-popover shadow-lg ring-1 ring-border"
            style={{
              top: Math.max(0, selectionAnchor.top - 48),
              left: popoverLeft(selectionAnchor, TOOLBAR_WIDTH_PX),
            }}
            onMouseDown={(event) => {
              if (!(event.target as HTMLElement).closest("input")) event.preventDefault();
            }}
          >
            <SelectionToolbar editor={editor} onComment={startComment} />
          </div>
        ) : null}

        {commentDraft ? (
          <div
            className="absolute z-20 rounded-2xl bg-popover p-3 shadow-lg ring-1 ring-border"
            style={{
              top: commentDraft.anchor.bottom + 8,
              left: popoverLeft(commentDraft.anchor, POPOVER_WIDTH_PX),
              width: POPOVER_WIDTH_PX,
            }}
          >
            <CommentComposer
              placeholder={agentName ? `Comment, or ask ${agentName}` : "Comment"}
              agentName={agentName}
              defaultSendToAgent
              autoFocus
              onSubmit={submitComment}
              onCancel={() => {
                setCommentDraft(null);
                editor?.commands.focus();
              }}
            />
          </div>
        ) : null}
      </div>
    </ScrollArea>
  );
}
