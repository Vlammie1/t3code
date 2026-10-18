import {
  CircleCheckIcon,
  CircleDashedIcon,
  CircleDotIcon,
  MessageCircleQuestionIcon,
  type LucideIcon,
} from "lucide-react";

import { cn } from "~/lib/utils";
import type { SidebarStatusGroup, SidebarThreadFilter } from "../Sidebar.logic";

const STATUS_OPTIONS: ReadonlyArray<{
  readonly group: SidebarStatusGroup;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly iconClassName: string;
}> = [
  { group: "active", label: "Active", icon: CircleDashedIcon, iconClassName: "text-info" },
  {
    group: "attention",
    label: "Needs you",
    icon: MessageCircleQuestionIcon,
    iconClassName: "text-indigo-600 dark:text-indigo-300",
  },
  {
    group: "finished",
    label: "Finished",
    icon: CircleCheckIcon,
    iconClassName: "text-success",
  },
];

function FilterChip(props: {
  readonly pressed: boolean;
  readonly label: string;
  readonly icon: LucideIcon;
  readonly iconClassName: string;
  readonly onToggle: () => void;
}) {
  const Icon = props.icon;
  return (
    <button
      type="button"
      aria-pressed={props.pressed}
      // Keep focus in the project search field so typing still narrows the list.
      onMouseDown={(event) => event.preventDefault()}
      onClick={props.onToggle}
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full px-2.5 text-xs font-medium transition-colors",
        props.pressed
          ? "bg-foreground/12 text-foreground ring-1 ring-foreground/15"
          : "bg-foreground/5 text-muted-foreground hover:bg-foreground/8 hover:text-foreground",
      )}
    >
      <Icon className={cn("size-3.5", props.iconClassName)} aria-hidden />
      {props.label}
    </button>
  );
}

export function SidebarThreadFilterSection(props: {
  readonly filter: SidebarThreadFilter;
  readonly onFilterChange: (filter: SidebarThreadFilter) => void;
}) {
  const { filter, onFilterChange } = props;
  const toggleGroup = (group: SidebarStatusGroup) =>
    onFilterChange({
      ...filter,
      groups: filter.groups.includes(group)
        ? filter.groups.filter((candidate) => candidate !== group)
        : [...filter.groups, group],
    });
  const active = filter.groups.length > 0 || filter.unreadOnly;

  return (
    <div className="flex flex-col gap-2 border-b border-border/60 px-2.5 pt-2.5 pb-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Status</span>
        {active ? (
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onFilterChange({ groups: [], unreadOnly: false })}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {STATUS_OPTIONS.map((option) => (
          <FilterChip
            key={option.group}
            pressed={filter.groups.includes(option.group)}
            label={option.label}
            icon={option.icon}
            iconClassName={option.iconClassName}
            onToggle={() => toggleGroup(option.group)}
          />
        ))}
        <FilterChip
          pressed={filter.unreadOnly}
          label="New"
          icon={CircleDotIcon}
          iconClassName="text-primary"
          onToggle={() => onFilterChange({ ...filter, unreadOnly: !filter.unreadOnly })}
        />
      </div>
    </div>
  );
}
