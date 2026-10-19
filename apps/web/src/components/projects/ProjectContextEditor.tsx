import type { ProjectContextEntry } from "@t3tools/contracts";
import { useState, type DragEvent } from "react";

import { FileIcon, FolderIcon, PlusIcon, XIcon } from "~/components/appIcons";
import { readLocalApi } from "~/localApi";
import { cn } from "~/lib/utils";
import { StartTruncatedPath } from "../StartTruncatedPath";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { pathBaseName } from "./projects.logic";

export interface ProjectContextRow {
  readonly path: string;
  /** Unknown until the server has looked at the path. */
  readonly kind?: ProjectContextEntry["kind"];
}

function droppedPaths(event: DragEvent): ReadonlyArray<string> {
  const getPathForFile = window.desktopBridge?.getPathForFile;
  if (!getPathForFile) return [];
  return Array.from(event.dataTransfer.files).flatMap((file) => {
    const path = getPathForFile(file);
    return path ? [path] : [];
  });
}

export function ProjectContextEditor({
  rows,
  canPickFolder,
  optional = false,
  disabled = false,
  onAdd,
  onRemove,
}: {
  readonly rows: ReadonlyArray<ProjectContextRow>;
  /** The native picker browses this machine, so only when the project lives here. */
  readonly canPickFolder: boolean;
  readonly optional?: boolean;
  readonly disabled?: boolean;
  readonly onAdd: (paths: ReadonlyArray<string>) => void;
  readonly onRemove: (path: string) => void;
}) {
  const [typing, setTyping] = useState(false);
  const [typedPath, setTypedPath] = useState("");
  const [dragging, setDragging] = useState(false);
  const canDrop = typeof window.desktopBridge?.getPathForFile === "function";

  const pickFolder = async () => {
    const picked = await readLocalApi()?.dialogs.pickFolder();
    if (picked) onAdd([picked]);
  };
  // Not a <form>: the editor also sits inside the new-project form.
  const submitTyped = () => {
    if (typedPath.trim() === "") return;
    onAdd([typedPath]);
    setTypedPath("");
    setTyping(false);
  };
  const dropHandlers = canDrop
    ? {
        onDragOver: (event: DragEvent) => {
          if (disabled || !event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          setDragging(true);
        },
        onDragLeave: (event: DragEvent) => {
          if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
          setDragging(false);
        },
        onDrop: (event: DragEvent) => {
          event.preventDefault();
          setDragging(false);
          const paths = droppedPaths(event);
          if (paths.length > 0) onAdd(paths);
        },
      }
    : {};

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-xl border bg-card p-3 transition-colors",
        dragging && "border-ring bg-accent/40",
      )}
      {...dropHandlers}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">
          Context{" "}
          {optional ? <span className="font-normal text-muted-foreground">(optional)</span> : null}
        </span>
        <Menu>
          <Tooltip>
            <TooltipTrigger
              render={
                <MenuTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Add context"
                      disabled={disabled}
                    />
                  }
                />
              }
            >
              <PlusIcon />
            </TooltipTrigger>
            <TooltipPopup side="top">Add context</TooltipPopup>
          </Tooltip>
          <MenuPopup align="end">
            {canPickFolder ? (
              <MenuItem onClick={() => void pickFolder()}>
                <FolderIcon />
                Choose folder
              </MenuItem>
            ) : null}
            <MenuItem onClick={() => setTyping(true)}>
              <FileIcon />
              Type a path
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>

      {rows.length > 0 ? (
        <ul className="flex flex-col">
          {rows.map((row) => {
            const Icon = row.kind === "file" ? FileIcon : FolderIcon;
            return (
              <li
                key={row.path}
                className="group/context flex min-w-0 items-center gap-2.5 rounded-lg px-1.5 py-1.5 hover:bg-accent/60"
              >
                <Icon className="size-4 shrink-0 text-icon-muted" />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm">{pathBaseName(row.path)}</span>
                  <StartTruncatedPath className="text-xs text-muted-foreground" path={row.path} />
                </span>
                <span className="flex shrink-0 opacity-0 group-hover/context:opacity-100 has-focus-visible:opacity-100">
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          variant="ghost-muted"
                          size="icon-xs"
                          aria-label={`Remove ${pathBaseName(row.path)}`}
                          disabled={disabled}
                          onClick={() => onRemove(row.path)}
                        />
                      }
                    >
                      <XIcon />
                    </TooltipTrigger>
                    <TooltipPopup side="top">Remove</TooltipPopup>
                  </Tooltip>
                </span>
              </li>
            );
          })}
        </ul>
      ) : typing ? null : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => (canPickFolder ? void pickFolder() : setTyping(true))}
          className="flex min-h-24 items-center justify-center rounded-lg border border-dashed px-4 text-center text-sm text-muted-foreground outline-none transition-colors hover:bg-accent/40 hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        >
          {canDrop
            ? "Drop in folders or files, or add them here"
            : "Add the folders, repositories or files this project works from"}
        </button>
      )}

      {typing ? (
        <div className="flex items-center gap-2">
          <Input
            autoFocus
            size="sm"
            value={typedPath}
            aria-label="Path"
            placeholder="Full path to a folder or file"
            onChange={(event) => setTypedPath(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submitTyped();
              } else if (event.key === "Escape") {
                event.stopPropagation();
                setTyping(false);
                setTypedPath("");
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={typedPath.trim() === ""}
            onClick={submitTyped}
          >
            Add
          </Button>
        </div>
      ) : null}
    </div>
  );
}
