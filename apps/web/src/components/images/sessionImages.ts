import {
  resolveViewedImageAsset,
  workEntryViewedImagePath,
  type ViewedImageAsset,
} from "@t3tools/client-runtime/work-log/presentation";
import type { AssetResource, ThreadId } from "@t3tools/contracts";

import type { TimelineEntry } from "../../session-logic";
import { isImageAttachment } from "../../types";

export type SessionImage =
  | {
      readonly id: string;
      readonly origin: "read";
      readonly createdAt: string;
      readonly name: string;
      readonly path: string;
      readonly asset: ViewedImageAsset;
    }
  | {
      readonly id: string;
      readonly origin: "attached";
      readonly createdAt: string;
      readonly name: string;
      /** Local blob/data preview while the upload is optimistic, else the stored attachment. */
      readonly src: string | null;
      readonly resource: Extract<AssetResource, { readonly _tag: "attachment" }> | null;
    };

function baseName(path: string): string {
  return path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1) || path;
}

/**
 * Every image the agent opened in this thread, plus the images the user sent,
 * in timeline order. A file the agent read more than once appears once, at its
 * first read, so paging through the list never shows the same picture twice.
 */
export function collectSessionImages(
  entries: ReadonlyArray<TimelineEntry>,
  input: { readonly threadId: ThreadId; readonly workspaceRoot: string | null | undefined },
): SessionImage[] {
  const images: SessionImage[] = [];
  const seenPaths = new Set<string>();
  for (const entry of entries) {
    if (entry.kind === "work") {
      const path = workEntryViewedImagePath(entry.entry);
      if (path === null || seenPaths.has(path)) continue;
      const asset = resolveViewedImageAsset(path, input);
      if (asset === null) continue;
      seenPaths.add(path);
      images.push({
        id: `read:${entry.id}`,
        origin: "read",
        createdAt: entry.createdAt,
        name: baseName(path),
        path,
        asset,
      });
      continue;
    }
    if (entry.kind !== "message" || entry.message.role !== "user") continue;
    for (const attachment of entry.message.attachments ?? []) {
      if (!isImageAttachment(attachment)) continue;
      const previewUrl = attachment.previewUrl;
      const local = previewUrl?.startsWith("blob:") || previewUrl?.startsWith("data:");
      images.push({
        id: `attached:${attachment.id}`,
        origin: "attached",
        createdAt: entry.createdAt,
        name: attachment.name,
        src: local ? (previewUrl ?? null) : null,
        resource: local ? null : { _tag: "attachment", attachmentId: attachment.id },
      });
    }
  }
  return images;
}
