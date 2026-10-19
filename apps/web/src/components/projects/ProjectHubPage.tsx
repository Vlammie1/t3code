import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  PROJECT_BRIEF_GOAL_MAX_LENGTH,
  type ProjectBrief,
  type ProjectId,
  type ProjectUpdateBriefInput,
} from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import {
  BotIcon,
  FolderOpenIcon,
  MessageSquareIcon,
  PencilIcon,
  PlusIcon,
} from "~/components/appIcons";
import { isElectron } from "../../env";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useEscapeToGoBack } from "../../hooks/useNavigateBack";
import { useProject, useThreadShellsForProjectRefs } from "../../state/entities";
import { primaryEnvironmentIdAtom } from "../../state/primaryEnvironment";
import { useProjectBrief } from "../../state/projectBriefs";
import { projectEnvironment } from "../../state/projects";
import { useAtomCommand } from "../../state/use-atom-command";
import { buildThreadRouteParams } from "../../threadRoutes";
import { ProjectFavicon } from "../ProjectFavicon";
import { RelativeTime } from "../RelativeTime";
import { resolveThreadStatusPill } from "../Sidebar.logic";
import { StartTruncatedPath } from "../StartTruncatedPath";
import { ThreadStatusLabel } from "../ThreadStatusIndicators";
import { Button } from "../ui/button";
import { ScrollArea } from "../ui/scroll-area";
import { SidebarInset } from "../ui/sidebar";
import { Textarea } from "../ui/textarea";
import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  WorkspaceBreadcrumb,
  WorkspaceBreadcrumbItem,
  WorkspaceBreadcrumbSeparator,
  WorkspaceBreadcrumbText,
} from "../WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { ProjectContextEditor } from "./ProjectContextEditor";
import { collectProjectThreads, mergeContextPaths } from "./projects.logic";

export function ProjectHubPage({
  environmentId,
  projectId,
}: {
  readonly environmentId: EnvironmentId;
  readonly projectId: ProjectId;
}) {
  useEscapeToGoBack();
  const navigate = useNavigate();
  const projectRef = scopeProjectRef(environmentId, projectId);
  const project = useProject(projectRef);
  const brief = useProjectBrief(project);
  const threads = useThreadShellsForProjectRefs([projectRef]);
  const primaryEnvironmentId = useAtomValue(primaryEnvironmentIdAtom);
  const handleNewThread = useNewThreadHandler();
  const updateBrief = useAtomCommand(projectEnvironment.updateBrief, { reportFailure: false });
  const [saving, setSaving] = useState(false);

  const openThread = (thread: EnvironmentThreadShell) =>
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
    });

  const saveBrief = async (patch: Omit<ProjectUpdateBriefInput, "projectId">) => {
    setSaving(true);
    const result = await updateBrief({ environmentId, input: { projectId, ...patch } });
    setSaving(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Could not save the project",
          description: error instanceof Error ? error.message : "An error occurred.",
        }),
      );
      return false;
    }
    return result._tag === "Success";
  };

  const header = (
    <WorkspacePageHeader electron={isElectron}>
      <WorkspaceBreadcrumb ariaLabel="Project breadcrumb" className="min-w-0 flex-1">
        <WorkspaceBreadcrumbItem>
          <Link to="/projects" className="rounded-sm hover:text-foreground">
            <WorkspaceBreadcrumbText>Projects</WorkspaceBreadcrumbText>
          </Link>
        </WorkspaceBreadcrumbItem>
        {project ? (
          <>
            <WorkspaceBreadcrumbSeparator />
            <WorkspaceBreadcrumbItem current className="min-w-0 shrink">
              <WorkspaceBreadcrumbText>{project.title}</WorkspaceBreadcrumbText>
            </WorkspaceBreadcrumbItem>
          </>
        ) : null}
      </WorkspaceBreadcrumb>
      {project && brief ? (
        <Button size="sm" variant="outline" onClick={() => void handleNewThread(projectRef)}>
          <PlusIcon />
          New chat
        </Button>
      ) : null}
    </WorkspacePageHeader>
  );

  if (project === null || brief === null) {
    return (
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
          {header}
          <p className="py-24 text-center text-sm text-muted-foreground">
            {project === null ? "Loading the project…" : "This folder has no project brief."}
          </p>
        </div>
      </SidebarInset>
    );
  }

  const { coordinator, chats } = collectProjectThreads(threads, brief.coordinatorThreadId);

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none isolate">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background text-foreground">
        {header}
        <ScrollArea className="min-h-0 flex-1">
          <WorkspacePageContainer width="expanded">
            <div className="flex items-start gap-4">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-foreground/5">
                <ProjectFavicon project={project} className="size-6" />
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-1">
                <h1 className="truncate text-xl font-semibold">{project.title}</h1>
                <GoalEditor
                  goal={brief.goal}
                  saving={saving}
                  onSave={(goal) => saveBrief({ goal })}
                />
              </div>
            </div>

            <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <div className="flex min-w-0 flex-col gap-6">
                <CoordinatorCard
                  coordinator={coordinator}
                  onOpen={() => coordinator && openThread(coordinator)}
                />
                <section className="flex flex-col gap-2">
                  <h2 className="flex items-baseline gap-2 text-sm font-medium">
                    Chats
                    {chats.length > 0 ? (
                      <span className="text-muted-foreground tabular-nums">{chats.length}</span>
                    ) : null}
                  </h2>
                  {chats.length === 0 ? (
                    <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                      Chats the coordinator starts show up here.
                    </p>
                  ) : (
                    <ul className="flex flex-col rounded-xl border bg-card p-1.5">
                      {chats.map((thread) => (
                        <ChatRow
                          key={thread.id}
                          thread={thread}
                          onOpen={() => openThread(thread)}
                        />
                      ))}
                    </ul>
                  )}
                </section>
              </div>

              <aside className="flex min-w-0 flex-col gap-3">
                <ProjectContextEditor
                  rows={brief.context}
                  canPickFolder={isElectron && environmentId === primaryEnvironmentId}
                  disabled={saving}
                  onAdd={(paths) =>
                    void saveBrief({
                      contextPaths: mergeContextPaths(
                        brief.context.map((entry) => entry.path),
                        paths,
                      ),
                    })
                  }
                  onRemove={(path) =>
                    void saveBrief({
                      contextPaths: brief.context
                        .map((entry) => entry.path)
                        .filter((entry) => entry !== path),
                    })
                  }
                />
                <div className="flex min-w-0 items-center gap-2 px-1 text-xs text-muted-foreground">
                  <FolderOpenIcon className="size-3.5 shrink-0 text-icon-muted" />
                  <StartTruncatedPath path={project.workspaceRoot} />
                </div>
              </aside>
            </div>
          </WorkspacePageContainer>
        </ScrollArea>
      </div>
    </SidebarInset>
  );
}

function GoalEditor({
  goal,
  saving,
  onSave,
}: {
  readonly goal: ProjectBrief["goal"];
  readonly saving: boolean;
  readonly onSave: (goal: string) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const save = async () => {
    if (draft === null) return;
    if (draft.trim() === goal || (await onSave(draft.trim()))) setDraft(null);
  };

  if (draft === null) {
    return (
      <button
        type="button"
        onClick={() => setDraft(goal)}
        className="group/goal flex w-fit max-w-full items-start gap-1.5 rounded-md text-left text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="whitespace-pre-wrap">{goal === "" ? "Add a goal" : goal}</span>
        <PencilIcon className="mt-0.5 size-3.5 shrink-0 opacity-0 group-hover/goal:opacity-100" />
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <Textarea
        autoFocus
        value={draft}
        aria-label="Goal"
        maxLength={PROJECT_BRIEF_GOAL_MAX_LENGTH}
        placeholder="What should this project achieve?"
        onChange={(event) => setDraft(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            setDraft(null);
          } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void save();
          }
        }}
      />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" disabled={saving} onClick={() => setDraft(null)}>
          Cancel
        </Button>
        <Button size="sm" disabled={saving} onClick={() => void save()}>
          Save goal
        </Button>
      </div>
    </div>
  );
}

function CoordinatorCard({
  coordinator,
  onOpen,
}: {
  readonly coordinator: EnvironmentThreadShell | null;
  readonly onOpen: () => void;
}) {
  const status = coordinator ? resolveThreadStatusPill({ thread: coordinator }) : null;
  const lastActiveAt =
    coordinator === null
      ? null
      : (coordinator.latestRun?.completedAt ??
        coordinator.latestRun?.requestedAt ??
        coordinator.createdAt);
  return (
    <section className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4">
      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-foreground/5">
        <BotIcon className="size-5 text-icon-muted" />
      </span>
      <div className="flex min-w-40 flex-1 flex-col">
        <span className="flex items-center gap-2 font-medium">
          Coordinator
          {status ? <ThreadStatusLabel status={status} /> : null}
        </span>
        {lastActiveAt !== null ? (
          <span className="text-xs text-muted-foreground">
            Active <RelativeTime timestamp={lastActiveAt} />
          </span>
        ) : null}
      </div>
      <Button size="sm" disabled={coordinator === null} onClick={onOpen}>
        <MessageSquareIcon />
        {coordinator === null ? "Starting…" : "Talk to the coordinator"}
      </Button>
    </section>
  );
}

function ChatRow({
  thread,
  onOpen,
}: {
  readonly thread: EnvironmentThreadShell;
  readonly onOpen: () => void;
}) {
  const status = resolveThreadStatusPill({ thread });
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex w-full min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm outline-none hover:bg-accent/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <span className="flex size-3.5 shrink-0 items-center justify-center">
          {status ? (
            <ThreadStatusLabel status={status} compact />
          ) : (
            <span className="size-1.5 rounded-full bg-muted-foreground/30" />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate">{thread.title}</span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
          <RelativeTime timestamp={thread.latestRun?.completedAt ?? thread.updatedAt} />
        </span>
      </button>
    </li>
  );
}
