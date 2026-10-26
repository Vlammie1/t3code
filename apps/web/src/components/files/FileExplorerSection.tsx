import type { ReactNode } from "react";
import { cn } from "../../lib/utils";
import { CollapsibleSectionHeader } from "../ui/collapsible-section-header";

/** One of the folders a thread reads, stacked under the others; open sections share the height. */
export function FileExplorerSection(props: {
  readonly name: string;
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex min-h-0 flex-col border-t border-border/60 first:border-t-0",
        props.expanded && "flex-1",
      )}
    >
      <div className="shrink-0 px-1 pt-1">
        <CollapsibleSectionHeader
          variant="panel"
          expanded={props.expanded}
          onClick={props.onToggle}
        >
          {props.name}
        </CollapsibleSectionHeader>
      </div>
      {props.expanded ? props.children : null}
    </section>
  );
}
