import { useAtomValue } from "@effect/atom-react";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { BriefcaseIcon, ChevronDownIcon, PlusIcon, SearchIcon } from "~/components/appIcons";
import { isElectron } from "../../env";
import { useEscapeToGoBack } from "../../hooks/useNavigateBack";
import { useActiveEnvironmentId, useThreadShells } from "../../state/entities";
import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
import { type BriefedProject, useBriefedProjects } from "../../state/projectBriefs";
import { ProjectFavicon } from "../ProjectFavicon";
import { RelativeTime } from "../RelativeTime";
import { Button } from "../ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { NewProjectDialog } from "./NewProjectDialog";
import {
  collectProjectThreads,
  filterAndSortProjects,
  PROJECT_SORT_LABELS,
  type ProjectSort,
  type ProjectThreads,
} from "./projects.logic";

const projectKey = (item: Pick<BriefedProject, "project">) =>
  `${item.project.environmentId}:${item.project.id}`;

function groupThreadsByProject(threads: ReadonlyArray<EnvironmentThreadShell>) {
  const byProject = new Map<string, Array<EnvironmentThreadShell>>();
  for (const thread of threads) {
    const key = `${thread.environmentId}:${thread.projectId}`;
    const list = byProject.get(key);
    if (list) list.push(thread);
    else byProject.set(key, [thread]);
  }
  return byProject;
}

export function ProjectsPage() {
  useEscapeToGoBack();
  const briefed = useBriefedProjects();
  const threads = useThreadShells();
  const primaryEnvironmentId = useAtomValue(primaryEnvironmentIdAtom);
  const activeEnvironmentId = useActiveEnvironmentId();
  const createEnvironmentId = primaryEnvironmentId ?? activeEnvironmentId;
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<ProjectSort>("activity");
  const [creating, setCreating] = useState(false);

  const threadsByProject = groupThreadsByProject(threads);
  const summaries = new Map<string, ProjectThreads>(
    briefed.map((item) => [
      projectKey(item),
      collectProjectThreads(
        threadsByProject.get(projectKey(item)) ?? [],
        item.brief.coordinatorThreadId,
      ),
    ]),
  );
  const shown = filterAndSortProjects(briefed, {
    query,
    sort,
    lastActivityAt: (item) => summaries.get(projectKey(item))?.lastActivityAt ?? null,
  });

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        <WorkspacePageHeader electron={isElectron}>
          <WorkspaceBreadcrumb ariaLabel="Projects breadcrumb" className="min-w-0 flex-1">
            <WorkspaceBreadcrumbItem current>
              <h1>Projects</h1>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>
          {briefed.length > 0 ? (
            <div className="flex shrink-0 items-center gap-2">
              <Menu>
                <MenuTrigger render={<Button variant="ghost" size="sm" />}>
                  <span className="text-muted-foreground">Sort by</span>
                  {PROJECT_SORT_LABELS[sort]}
                  <ChevronDownIcon />
                </MenuTrigger>
                <MenuPopup align="end">
                  <MenuRadioGroup
                    value={sort}
                    onValueChange={(value) => setSort(value as ProjectSort)}
                  >
                    {(Object.keys(PROJECT_SORT_LABELS) as Array<ProjectSort>).map((option) => (
                      <MenuRadioItem key={option} value={option}>
                        {PROJECT_SORT_LABELS[option]}
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuPopup>
              </Menu>
              <Button
                size="sm"
                disabled={createEnvironmentId === null}
                onClick={() => setCreating(true)}
              >
                <PlusIcon />
                New project
              </Button>
            </div>
          ) : null}
        </WorkspacePageHeader>

        <ScrollArea className="min-h-0 flex-1">
          <WorkspacePageContainer width="wide">
            {briefed.length === 0 ? (
              <div className="flex flex-col items-center gap-4 py-24 text-center">
                <span className="flex size-12 items-center justify-center rounded-full bg-foreground/5">
                  <BriefcaseIcon className="size-6 text-icon-muted" />
                </span>
                <div className="flex max-w-sm flex-col gap-1.5">
                  <h2 className="font-medium">Start a project</h2>
                  <p className="text-sm text-muted-foreground">
                    Give it a goal and the folders it works from. A coordinator plans the work and
                    starts the chats for it.
                  </p>
                </div>
                <Button disabled={createEnvironmentId === null} onClick={() => setCreating(true)}>
                  <PlusIcon />
                  New project
                </Button>
              </div>
            ) : (
              <>
                <InputGroup>
                  <InputGroupAddon>
                    <SearchIcon />
                  </InputGroupAddon>
                  <InputGroupInput
                    type="search"
                    value={query}
                    aria-label="Search projects"
                    placeholder="Search projects…"
                    onChange={(event) => setQuery(event.currentTarget.value)}
                  />
                </InputGroup>
                {shown.length === 0 ? (
                  <p className="py-12 text-center text-sm text-muted-foreground">
                    No project matches “{query.trim()}”.
                  </p>
                ) : (
                  <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {shown.map((item) => (
                      <li key={projectKey(item)} className="flex">
                        <ProjectCard item={item} threads={summaries.get(projectKey(item))} />
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </WorkspacePageContainer>
        </ScrollArea>
      </div>
      {createEnvironmentId !== null ? (
        <NewProjectDialog
          environmentId={createEnvironmentId}
          canPickFolder={isElectron && createEnvironmentId === primaryEnvironmentId}
          open={creating}
          onOpenChange={setCreating}
        />
      ) : null}
    </SidebarInset>
  );
}

function ProjectCard({
  item,
  threads,
}: {
  readonly item: BriefedProject;
  readonly threads: ProjectThreads | undefined;
}) {
  const { project, brief } = item;
  const chatCount = threads?.chats.length ?? 0;
  const status = threads?.headline ?? null;
  return (
    <Link
      to="/projects/$environmentId/$projectId"
      params={{ environmentId: project.environmentId, projectId: project.id }}
      className="flex min-h-36 w-full flex-col gap-3 rounded-xl border bg-card p-4 outline-none transition-colors hover:border-foreground/16 hover:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex size-9 items-center justify-center rounded-lg bg-foreground/5">
          <ProjectFavicon project={project} className="size-5" />
        </span>
        {status ? (
          <span className={`inline-flex items-center gap-1.5 text-xs ${status.colorClass}`}>
            <span className={`size-1.5 rounded-full ${status.dotClass}`} />
            {status.label}
          </span>
        ) : null}
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <span className="truncate font-medium">{project.title}</span>
        {brief.goal !== "" ? (
          <p className="line-clamp-2 text-sm text-muted-foreground">{brief.goal}</p>
        ) : null}
      </div>
      <div className="mt-auto flex items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
        <span>{chatCount === 1 ? "1 chat" : `${chatCount} chats`}</span>
        <span aria-hidden="true">·</span>
        <RelativeTime timestamp={threads?.lastActivityAt ?? project.createdAt} />
      </div>
    </Link>
  );
}
