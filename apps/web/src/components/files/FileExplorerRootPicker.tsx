import { FolderIcon } from "~/components/appIcons";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import type { FileExplorerRoot } from "./FilePreviewPanel";

// Select values are strings; the workspace itself has no path of its own here.
const WORKSPACE_VALUE = "";

/** Switches the explorer between the workspace and the other folders the thread reads. */
export function FileExplorerRootPicker(props: {
  readonly projectName: string;
  readonly roots: ReadonlyArray<FileExplorerRoot>;
  readonly value: string | null;
  readonly onChange: (path: string | null) => void;
}) {
  const current = props.roots.find((root) => root.path === props.value);
  return (
    <div className="shrink-0 border-b border-border/60 p-1.5">
      <Select
        value={props.value ?? WORKSPACE_VALUE}
        onValueChange={(value) =>
          props.onChange(value === null || value === WORKSPACE_VALUE ? null : value)
        }
      >
        <SelectTrigger size="xs" className="w-full" aria-label="Folder">
          <SelectValue>
            <span className="flex min-w-0 items-center gap-1.5">
              <FolderIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{current?.name ?? props.projectName}</span>
            </span>
          </SelectValue>
        </SelectTrigger>
        <SelectPopup align="start" alignItemWithTrigger={false}>
          <SelectItem value={WORKSPACE_VALUE}>{props.projectName}</SelectItem>
          {props.roots.map((root) => (
            <SelectItem key={root.path} value={root.path}>
              {root.name}
            </SelectItem>
          ))}
        </SelectPopup>
      </Select>
    </div>
  );
}
