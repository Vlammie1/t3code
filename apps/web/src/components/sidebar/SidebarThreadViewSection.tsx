import type { SidebarThreadView } from "../Sidebar.logic";
import { Toggle, ToggleGroup } from "../ui/toggle-group";

const VIEW_OPTIONS: ReadonlyArray<{ readonly value: SidebarThreadView; readonly label: string }> = [
  { value: "status", label: "Status" },
  { value: "project", label: "Project" },
  { value: "recent", label: "Newest" },
];

function isSidebarThreadView(value: unknown): value is SidebarThreadView {
  return VIEW_OPTIONS.some((option) => option.value === value);
}

export function SidebarThreadViewSection(props: {
  readonly view: SidebarThreadView;
  readonly onViewChange: (view: SidebarThreadView) => void;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-border/60 p-2.5">
      <span className="text-xs font-medium text-muted-foreground">Group by</span>
      <ToggleGroup
        aria-label="Group threads by"
        className="w-full *:flex-1"
        value={[props.view]}
        onValueChange={(next) => {
          const value = next[0];
          if (isSidebarThreadView(value)) props.onViewChange(value);
        }}
      >
        {VIEW_OPTIONS.map((option) => (
          <Toggle
            key={option.value}
            value={option.value}
            // Keep focus in the project search field so typing still narrows the list.
            onMouseDown={(event) => event.preventDefault()}
          >
            {option.label}
          </Toggle>
        ))}
      </ToggleGroup>
    </div>
  );
}
