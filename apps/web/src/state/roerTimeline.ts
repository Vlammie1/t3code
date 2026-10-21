import {
  MessageId,
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2TurnItem,
  type RoerActivityEntry,
  type ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

/**
 * The cloud part of a thread as turn items, so the chat shows it with the same rows as work done here: a command is a
 * command, an edit an edit. They are synthetic: nothing here stores them, Roer holds the record.
 */

// Past any position a thread here reaches; positions only need to be unique, the order comes from the merge.
const POSITION_OFFSET = 2_000_000_000;

const FILE_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const SEARCH_TOOLS = new Set(["Grep", "Glob"]);

const statusOf = (entry: RoerActivityEntry): OrchestrationV2TurnItem["status"] => {
  if (entry.live) return "running";
  return entry.tool?.failed ? "failed" : "completed";
};

function turnItemFor(threadId: ThreadId, entry: RoerActivityEntry): OrchestrationV2TurnItem {
  const at = DateTime.makeUnsafe(entry.at);
  const id = TurnItemId.make(`roer:${threadId}:${entry.id}`);
  const base = {
    id,
    threadId,
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: entry.seq,
    status: statusOf(entry),
    title: null,
    startedAt: at,
    completedAt: entry.live ? null : at,
    updatedAt: at,
  } as const;
  switch (entry.kind) {
    case "user":
      return {
        ...base,
        type: "user_message",
        createdBy: "user",
        creationSource: "server",
        messageId: MessageId.make(id),
        inputIntent: "turn_start",
        text: entry.text,
        attachments: [],
      };
    case "assistant":
      return {
        ...base,
        type: "assistant_message",
        messageId: MessageId.make(id),
        text: entry.text,
        streaming: entry.live,
      };
    case "reasoning":
      return { ...base, type: "reasoning", text: entry.text, streaming: entry.live };
    case "notice":
      return { ...base, type: "system_notice", message: entry.text };
    case "error":
      return {
        ...base,
        type: "error",
        status: "failed",
        failure: { class: "unknown", message: entry.text, code: null, retryable: null },
      };
    case "tool": {
      const tool = entry.tool;
      const name = tool?.name ?? "Tool";
      if (name === "Bash") return { ...base, type: "command_execution", input: entry.text };
      const file = tool?.file ?? entry.text;
      if (FILE_TOOLS.has(name) && file) {
        return {
          ...base,
          type: "file_change",
          fileName: file,
          ...(tool?.additions == null ? {} : { additions: tool.additions }),
          ...(tool?.deletions == null ? {} : { deletions: tool.deletions }),
        };
      }
      if (SEARCH_TOOLS.has(name)) return { ...base, type: "file_search", pattern: entry.text };
      if (name === "WebSearch") return { ...base, type: "web_search", patterns: [entry.text] };
      return {
        ...base,
        type: "dynamic_tool",
        title: entry.text ? `${name}: ${entry.text}` : name,
        toolName: name,
        input: {},
      };
    }
  }
}

// Unchanged entries keep their object across frames, so their rows keep theirs and skip rendering.
const cache = new WeakMap<RoerActivityEntry, OrchestrationV2ProjectedTurnItem>();

export function roerTurnItems(
  threadId: ThreadId,
  entries: ReadonlyArray<RoerActivityEntry>,
): OrchestrationV2ProjectedTurnItem[] {
  return entries.map((entry) => {
    const cached = cache.get(entry);
    if (cached !== undefined && cached.item.threadId === threadId) return cached;
    const item = turnItemFor(threadId, entry);
    const row: OrchestrationV2ProjectedTurnItem = {
      position: POSITION_OFFSET + entry.seq,
      visibility: "synthetic",
      sourceThreadId: threadId,
      sourceItemId: item.id,
      item,
    };
    cache.set(entry, row);
    return row;
  });
}

const timeOf = (row: OrchestrationV2ProjectedTurnItem) =>
  DateTime.toEpochMillis(row.item.startedAt ?? row.item.updatedAt);

/**
 * Puts the cloud rows between the rows from here by time. The thread here stands still while it is in the cloud, so
 * each stay lands as one block between the turns before and after it. Both lists keep their own order.
 */
export function mergeRoerTurnItems(
  local: ReadonlyArray<OrchestrationV2ProjectedTurnItem>,
  cloud: ReadonlyArray<OrchestrationV2ProjectedTurnItem>,
): ReadonlyArray<OrchestrationV2ProjectedTurnItem> {
  if (cloud.length === 0) return local;
  const merged: OrchestrationV2ProjectedTurnItem[] = [];
  let next = 0;
  for (const row of local) {
    const time = timeOf(row);
    while (next < cloud.length && timeOf(cloud[next]!) < time) merged.push(cloud[next++]!);
    merged.push(row);
  }
  while (next < cloud.length) merged.push(cloud[next++]!);
  return merged;
}
