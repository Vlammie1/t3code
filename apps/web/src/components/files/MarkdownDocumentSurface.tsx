import type { EnvironmentId, ScopedThreadRef } from "@t3tools/contracts";
import { resolvePathLinkTarget } from "@t3tools/shared/fileLinks";
import { isAtomCommandInterrupted } from "@t3tools/client-runtime/state/runtime";
import {
  memo,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { CheckIcon, MessageSquareIcon } from "~/components/appIcons";
import ChatMarkdown from "~/components/ChatMarkdown";
import { RelativeTime } from "~/components/RelativeTime";
import { Button } from "~/components/ui/button";
import { ScrollArea } from "~/components/ui/scroll-area";
import { Textarea } from "~/components/ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { stackedThreadToast, toastManager } from "~/components/ui/toast";
import { useStableCallback } from "~/hooks/useStableCallback";
import { observeResize } from "~/lib/observeResize";
import { cn, newMessageId } from "~/lib/utils";
import { useThreadShell } from "~/state/entities";
import { threadEnvironment } from "~/state/threads";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";

import { setMarkdownTaskChecked } from "./filePreviewMode";
import { appendMarkdownBlock, replaceMarkdownBlock, splitMarkdownBlocks } from "./markdownBlocks";
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
const MARGIN_LAYOUT_MIN_WIDTH = 820;
const CARD_GAP_PX = 8;
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
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) =>
      node.parentElement?.closest("[data-markdown-editing], textarea, button")
        ? NodeFilter.FILTER_REJECT
        : NodeFilter.FILTER_ACCEPT,
  });
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const textNode = node as Text;
    const value = textNode.data;
    nodes.push(textNode);
    for (let offset = 0; offset < value.length; offset += 1) {
      const character = value[offset]!;
      if (/\s/.test(character)) {
        if (text === "" || text.endsWith(" ")) continue;
        text += " ";
      } else {
        text += character;
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

/** Finds where the click lands in the block's source by the rendered text just before it. */
function sourceCaret(source: string, renderedPrefix: string): number {
  const prefix = renderedPrefix.replace(/\s+/g, " ");
  for (const length of [24, 12, 6, 3]) {
    if (prefix.length < length) continue;
    const tail = prefix.slice(-length);
    const index = source.replace(/\s/g, " ").indexOf(tail);
    if (index !== -1) return index + length;
  }
  return source.length;
}

const MarkdownBlockView = memo(
  function MarkdownBlockView(props: {
    readonly text: string;
    readonly start: number;
    readonly cwd: string;
    readonly imageBaseDir: string;
    readonly threadRef: ScopedThreadRef;
    readonly index: number;
    readonly onTaskListChange:
      | ((input: { readonly markerOffset: number; readonly checked: boolean }) => void)
      | undefined;
  }) {
    const { start, onTaskListChange } = props;
    return (
      <div data-markdown-block={props.index}>
        <ChatMarkdown
          text={props.text}
          cwd={props.cwd}
          imageBaseDir={props.imageBaseDir}
          threadRef={props.threadRef}
          onTaskListChange={
            onTaskListChange
              ? ({ markerOffset, checked }) =>
                  onTaskListChange({ markerOffset: start + markerOffset, checked })
              : undefined
          }
        />
      </div>
    );
  },
  // The panel hands down a fresh thread ref each render; only its identity matters here.
  (previous, next) =>
    previous.text === next.text &&
    previous.start === next.start &&
    previous.index === next.index &&
    previous.cwd === next.cwd &&
    previous.imageBaseDir === next.imageBaseDir &&
    previous.onTaskListChange === next.onTaskListChange &&
    previous.threadRef.environmentId === next.threadRef.environmentId &&
    previous.threadRef.threadId === next.threadRef.threadId,
);

function BlockEditor(props: {
  readonly initialText: string;
  readonly initialCaret: number;
  readonly placeholder?: string;
  readonly onDone: (text: string) => void;
}) {
  const [text, setText] = useState(props.initialText);
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const field = ref.current;
    if (!field) return;
    field.focus({ preventScroll: true });
    field.setSelectionRange(props.initialCaret, props.initialCaret);
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- Focus and caret are placed once, when editing starts.
  }, []);
  return (
    <div data-markdown-editing className="my-2">
      <textarea
        ref={ref}
        value={text}
        placeholder={props.placeholder}
        spellCheck
        aria-label="Edit block"
        className="field-sizing-content block min-h-12 w-full resize-none rounded-xl bg-foreground/5 px-3 py-2 font-mono text-sm leading-relaxed text-foreground outline-none placeholder:text-muted-foreground/70"
        onChange={(event) => setText(event.target.value)}
        onBlur={() => props.onDone(text)}
        onKeyDown={(event) => {
          if (
            event.key === "Escape" ||
            ((event.metaKey || event.ctrlKey) && event.key === "Enter")
          ) {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}

function CommentComposer(props: {
  readonly placeholder: string;
  readonly submitLabel: string;
  readonly autoFocus: boolean;
  readonly onSubmit: (text: string) => void;
  readonly onCancel?: () => void;
}) {
  const [text, setText] = useState("");
  const submit = () => {
    const trimmed = text.trim();
    if (trimmed === "") return;
    props.onSubmit(trimmed);
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
      {props.onCancel || text.trim() !== "" ? (
        <div className="flex justify-end gap-1.5">
          {props.onCancel ? (
            <Button variant="ghost" size="xs" onClick={props.onCancel}>
              Cancel
            </Button>
          ) : null}
          <Button size="xs" disabled={text.trim() === ""} onClick={submit}>
            {props.submitLabel}
          </Button>
        </div>
      ) : null}
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
  readonly comment: MarkdownComment;
  readonly active: boolean;
  readonly anchored: boolean;
  readonly writable: boolean;
  readonly ref: (element: HTMLDivElement | null) => void;
  readonly floating: boolean;
  readonly onActivate: () => void;
  readonly onReply: (text: string) => void;
  readonly onResolve: () => void;
}) {
  const { comment, ref } = props;
  return (
    <div
      ref={ref}
      data-markdown-comment={comment.id}
      className={cn(
        "group/comment flex flex-col gap-3 rounded-2xl bg-card p-3 shadow-xs ring-1 ring-border/70 transition-[top,box-shadow] duration-200 ease-out",
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
          placeholder="Reply, or @Claude to ask the agent"
          submitLabel="Reply"
          autoFocus={false}
          onSubmit={props.onReply}
        />
      ) : null}
    </div>
  );
}

interface CommentDraft {
  readonly quote: string;
}

interface EditingBlock {
  readonly index: number | "new";
  readonly originalText: string;
  readonly caret: number;
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
  const blocks = splitMarkdownBlocks(parsed.body);
  // An unreadable comments block would be lost on the next write, so it locks both.
  const editable = !props.readOnly && parsed.commentsWritable;

  const [editing, setEditing] = useState<EditingBlock | null>(null);
  const [commentDraft, setCommentDraft] = useState<CommentDraft | null>(null);
  const [selectionPrompt, setSelectionPrompt] = useState<{
    readonly quote: string;
    readonly top: number;
  } | null>(null);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [marginLayout, setMarginLayout] = useState(false);
  const [surfaceKey] = useState(() => ({}));
  const [anchoredIds, setAnchoredIds] = useState<ReadonlySet<string>>(new Set());

  const scrollRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  const documentRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);
  const draftCardRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef(new Map<string, HTMLDivElement>());
  const rangesRef = useRef(new Map<string, Range>());

  const lastSeparator = Math.max(relativePath.lastIndexOf("/"), relativePath.lastIndexOf("\\"));
  const imageBaseDir =
    lastSeparator >= 0 ? resolvePathLinkTarget(relativePath.slice(0, lastSeparator), cwd) : cwd;

  const currentContents = () =>
    getOptimisticProjectFileQueryData(environmentId, cwd, relativePath)?.contents ?? contents;
  const writeContents = (next: string) => {
    if (next === currentContents()) return;
    setProjectFileQueryData(environmentId, cwd, relativePath, next);
    saveCoordinator.change(next);
  };
  const writeBody = (transform: (body: string) => string) => {
    const current = parseCommentedMarkdown(currentContents());
    if (!current.commentsWritable) return;
    const body = transform(current.body);
    const hadBlock = current.comments.length > 0 || current.body !== currentContents();
    writeContents(hadBlock ? serializeCommentedMarkdown(body, current.comments) : body);
  };
  const updateComments = (
    transform: (comments: ReadonlyArray<MarkdownComment>) => ReadonlyArray<MarkdownComment>,
  ) => {
    const current = parseCommentedMarkdown(currentContents());
    if (!current.commentsWritable) return;
    writeContents(serializeCommentedMarkdown(current.body, transform(current.comments)));
  };

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

  const submitComment = (body: string) => {
    if (!commentDraft) return;
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
    if (mentionsAgent(body)) askAgent(comment, body);
  };

  const replyToComment = (comment: MarkdownComment, body: string) => {
    const reply = { author: USER_AUTHOR, body, createdAt: new Date().toISOString() };
    updateComments((comments) =>
      comments.map((entry) =>
        entry.id === comment.id ? { ...entry, replies: [...entry.replies, reply] } : entry,
      ),
    );
    if (mentionsAgent(body)) askAgent(comment, body);
  };

  const finishEditing = (text: string) => {
    const current = editing;
    setEditing(null);
    if (!current) return;
    if (current.index === "new") {
      writeBody((body) => appendMarkdownBlock(body, text));
      return;
    }
    if (text === current.originalText) return;
    const index = current.index;
    writeBody((body) => {
      const latest = splitMarkdownBlocks(body);
      // The file can change while a block is open; find the block by its text first.
      const target =
        latest[index]?.text === current.originalText
          ? latest[index]
          : latest.find((block) => block.text === current.originalText);
      return target ? replaceMarkdownBlock(body, target, text) : appendMarkdownBlock(body, text);
    });
  };

  const toggleTask = useStableCallback(
    ({ markerOffset, checked }: { readonly markerOffset: number; readonly checked: boolean }) =>
      writeBody((body) => setMarkdownTaskChecked(body, markerOffset, checked)),
  );

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

  const handleDocumentClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("a, button, input, textarea, summary, video, img, [role=button]")) return;
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed) return;
    const commentId = commentAtPoint(event.clientX, event.clientY);
    if (commentId !== null && commentId !== activeCommentId) {
      setActiveCommentId(commentId);
      cardRefs.current.get(commentId)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      return;
    }
    if (!editable) return;
    const blockElement = target.closest<HTMLElement>("[data-markdown-block]");
    if (!blockElement) return;
    const index = Number(blockElement.dataset.markdownBlock);
    const block = blocks[index];
    if (!block) return;
    let caret = block.text.length;
    const point = caretFromPoint(event.clientX, event.clientY);
    if (point && blockElement.contains(point.node)) {
      const prefix = document.createRange();
      prefix.setStart(blockElement, 0);
      prefix.setEnd(point.node, point.offset);
      caret = sourceCaret(block.text, prefix.toString());
    }
    setActiveCommentId(null);
    setEditing({ index, originalText: block.text, caret });
  };

  const readSelection = () => {
    const root = documentRef.current;
    const layout = layoutRef.current;
    const selection = window.getSelection();
    if (!root || !layout || !selection || selection.isCollapsed || selection.rangeCount === 0) {
      setSelectionPrompt(null);
      return;
    }
    const range = selection.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) {
      setSelectionPrompt(null);
      return;
    }
    const quote = normalizeCommentQuote(selection.toString());
    if (quote === "") {
      setSelectionPrompt(null);
      return;
    }
    const top = range.getBoundingClientRect().top - layout.getBoundingClientRect().top;
    setSelectionPrompt({ quote, top });
  };

  useEffect(() => {
    const onSelectionChange = () => {
      if (window.getSelection()?.isCollapsed) setSelectionPrompt(null);
    };
    document.addEventListener("selectionchange", onSelectionChange);
    return () => document.removeEventListener("selectionchange", onSelectionChange);
  }, []);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    return observeResize(element, (entries) => {
      const entry = entries.at(-1);
      if (entry) setMarginLayout(entry.contentRect.width >= MARGIN_LAYOUT_MIN_WIDTH);
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
    if (draftCardRef.current && commentDraft) {
      placements.push({
        element: draftCardRef.current,
        top: draftRange ? draftRange.getBoundingClientRect().top - railTop : 0,
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
    // oxlint-disable-next-line react/exhaustive-effect-dependencies -- The document element lives as long as the surface; layoutComments is stable.
  }, [layoutComments]);

  const setCardRef = (id: string) => (element: HTMLDivElement | null) => {
    if (element) cardRefs.current.set(id, element);
    else cardRefs.current.delete(id);
  };

  const comments = parsed.comments;
  const cards = comments.map((comment) => (
    <CommentCard
      key={comment.id}
      comment={comment}
      active={activeCommentId === comment.id}
      anchored={anchoredIds.has(comment.id)}
      writable={editable}
      floating={marginLayout}
      ref={setCardRef(comment.id)}
      onActivate={() => setActiveCommentId(comment.id)}
      onReply={(text) => replyToComment(comment, text)}
      onResolve={() => {
        updateComments((entries) => entries.filter((entry) => entry.id !== comment.id));
        if (activeCommentId === comment.id) setActiveCommentId(null);
      }}
    />
  ));
  const draftCard = commentDraft ? (
    <div
      ref={draftCardRef}
      className={cn(
        "flex flex-col gap-2 rounded-2xl bg-card p-3 shadow-md ring-1 ring-foreground/20",
        marginLayout && "absolute inset-x-0",
      )}
    >
      <p className="line-clamp-2 border-s-2 border-warning/60 ps-2 text-xs leading-relaxed text-muted-foreground">
        {commentDraft.quote}
      </p>
      <CommentComposer
        placeholder={props.draft ? "Comment" : "Comment, or @Claude to ask the agent"}
        submitLabel="Comment"
        autoFocus
        onSubmit={submitComment}
        onCancel={() => setCommentDraft(null)}
      />
    </div>
  ) : null;

  const startComment = () => {
    if (!selectionPrompt) return;
    setCommentDraft({ quote: selectionPrompt.quote });
    setActiveCommentId(null);
    setSelectionPrompt(null);
    window.getSelection()?.removeAllRanges();
  };

  return (
    <ScrollArea ref={scrollRef} className="min-h-0 flex-1">
      <div
        ref={layoutRef}
        className={cn(
          "relative mx-auto flex w-full gap-10 px-6 pt-10 pb-24 sm:px-10",
          marginLayout ? "max-w-[64rem]" : "max-w-[46rem] flex-col",
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
            data-editable={editable || undefined}
            onClick={handleDocumentClick}
            onMouseUp={readSelection}
            onKeyUp={(event) => {
              if (event.shiftKey) readSelection();
            }}
          >
            {blocks.map((block, index) =>
              editing?.index === index ? (
                <BlockEditor
                  key={`edit:${block.start}`}
                  initialText={block.text}
                  initialCaret={editing.caret}
                  onDone={finishEditing}
                />
              ) : (
                <MarkdownBlockView
                  key={`${block.start}:${block.text}`}
                  index={index}
                  text={block.text}
                  start={block.start}
                  cwd={cwd}
                  imageBaseDir={imageBaseDir}
                  threadRef={threadRef}
                  onTaskListChange={editable ? toggleTask : undefined}
                />
              ),
            )}
            {editing?.index === "new" ? (
              <BlockEditor
                initialText=""
                initialCaret={0}
                placeholder="Write in markdown"
                onDone={finishEditing}
              />
            ) : editable ? (
              <button
                type="button"
                className="mt-4 block w-full cursor-text py-3 text-start text-sm text-muted-foreground/0 transition-colors hover:text-muted-foreground/70 focus-visible:text-muted-foreground/70 focus-visible:outline-none"
                onClick={() => setEditing({ index: "new", originalText: "", caret: 0 })}
              >
                Click to write
              </button>
            ) : null}
          </div>
          {!marginLayout && (draftCard || cards.length > 0) ? (
            <section className="mt-12 flex flex-col gap-3">
              <h2 className="text-xs font-medium text-muted-foreground">Comments</h2>
              {draftCard}
              {cards}
            </section>
          ) : null}
        </div>
        {marginLayout ? (
          <div ref={railRef} className="relative w-64 shrink-0">
            {draftCard}
            {cards}
          </div>
        ) : null}
        {selectionPrompt && editable && !commentDraft ? (
          <div
            className={cn("absolute right-6 z-10 sm:right-10", marginLayout && "w-64")}
            style={{ top: selectionPrompt.top }}
          >
            <Button
              variant="outline"
              size="xs"
              // Keeps the selection alive until the click lands.
              onMouseDown={(event) => event.preventDefault()}
              onClick={startComment}
            >
              <MessageSquareIcon />
              Comment
            </Button>
          </div>
        ) : null}
      </div>
    </ScrollArea>
  );
}
