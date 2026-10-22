import {
  CommandId,
  type ModelSelection,
  type ProjectBrief,
  type ProjectContextEntry,
  type ProjectCreateWithBriefInput,
  type ProjectCreateWithBriefResult,
  ProjectId,
  type ProjectUpdateBriefInput,
  PROJECT_COORDINATOR_THREAD_ID_PREFIX,
  ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ManagedProjectFolders from "./ManagedProjectFolders.ts";
import * as ProjectService from "./ProjectService.ts";

export const COORDINATOR_THREAD_TITLE = "Coordinator";

/**
 * Coordinating is mostly reading and routing, so a fast model keeps the
 * conversation cheap; the threads it starts get the environment's default.
 */
export const COORDINATOR_MODEL_SELECTION: ModelSelection = {
  instanceId: "claudeAgent" as ModelSelection["instanceId"],
  model: "claude-sonnet-5-5",
  options: [{ id: "effort", value: "low" }],
};

const BRIEF_START = "<!-- t3:project-brief -->";
const BRIEF_END = "<!-- /t3:project-brief -->";

export class ProjectBriefError extends Schema.TaggedError<ProjectBriefError>()(
  "ProjectBriefError",
  {
    operation: Schema.Literals([
      "create-project",
      "set-icon",
      "read-project",
      "read-context",
      "write-brief-file",
      "launch-coordinator",
      "save-brief",
    ]),
    detail: Schema.String,
    cause: Schema.optional(Schema.Defect()),
  },
) {
  override get message(): string {
    return this.detail;
  }
}

export function renderProjectBriefSection(name: string, brief: ProjectBrief): string {
  const context =
    brief.context.length === 0
      ? ["None yet."]
      : [
          "Read these before you start; they live outside this folder:",
          "",
          ...brief.context.map(
            (entry) => `- \`${entry.path}\` (${entry.kind === "file" ? "file" : "folder"})`,
          ),
        ];
  return [
    BRIEF_START,
    "## Project brief",
    "",
    `This folder belongs to the T3 Code project "${name}". T3 Code rewrites this section when the goal or context changes in the project page; edit them there.`,
    "",
    "### Goal",
    "",
    brief.goal === "" ? "Not set yet." : brief.goal,
    "",
    "### Context",
    "",
    ...context,
    "",
    "### Threads",
    "",
    `The thread titled "${COORDINATOR_THREAD_TITLE}" plans the work and starts the other threads in this project. Finish your work with a short summary of what changed and what is left, so it can follow along.`,
    BRIEF_END,
  ].join("\n");
}

/** Replaces only T3 Code's own section, so notes agents or people add stay. */
export function withProjectBriefSection(
  existing: string | null,
  name: string,
  section: string,
): string {
  if (existing === null || existing.trim() === "") return `# ${name}\n\n${section}\n`;
  const start = existing.indexOf(BRIEF_START);
  const end = existing.indexOf(BRIEF_END);
  if (start !== -1 && end > start) {
    return `${existing.slice(0, start)}${section}${existing.slice(end + BRIEF_END.length)}`;
  }
  return `${existing.trimEnd()}\n\n${section}\n`;
}

export function coordinatorBriefing(input: {
  readonly name: string;
  readonly goal: string;
  readonly threadModel: ModelSelection | null;
}): string {
  const modelLine =
    input.threadModel === null
      ? "- Always pass `modelSelection` when you launch a thread, or it inherits your lightweight model. Pick one from `orchestrator_capabilities` that fits the task."
      : `- Always pass \`modelSelection\` when you launch a thread, or it inherits your lightweight model. Use \`${JSON.stringify(input.threadModel)}\` unless the task clearly needs less.`;
  return [
    `You are the coordinator of the T3 Code project "${input.name}". The user talks to you to get the project's work done: you plan it, start threads that do the work, and keep track of them.`,
    "",
    "The goal and context are in the project brief in AGENTS.md in this folder. T3 Code rewrites it when the user edits the project, so read it again before you plan new work.",
    "",
    "How to work:",
    "- Do small things yourself: answering, reading context, a quick look at a file. Start a separate thread for each independent piece of real work with `t3_thread_launch`, leaving out projectId so it lands in this project.",
    "- Give every thread a short title that starts with the name of the context folder it works in, like `Lockspace: paywall`, so the sidebar can show that folder instead of this project. Give it a self-contained `message`: the task, the context paths it needs, what done looks like, and to finish with a summary.",
    modelLine,
    "- Threads run in this folder and reach the context folders and repositories by their absolute paths.",
    "- Follow threads with `t3_thread_list`, `t3_thread_read` and `t3_thread_wait`; continue one with `t3_thread_send`. Link a thread for the user as `[title](t3-thread://v1/<threadId>)`.",
    "- Keep the user posted in a few lines: what runs, what finished, what needs their decision.",
    "- Reply in the language the user writes in.",
    "",
    input.goal === ""
      ? "Start now: ask the user in one or two sentences what this project should achieve."
      : "Start now: reply with a short plan for the goal (at most five points) and the thread you would start first. Start threads once the user agrees.",
  ].join("\n");
}

export class ProjectBriefService extends Context.Service<
  ProjectBriefService,
  {
    readonly create: (
      input: ProjectCreateWithBriefInput,
    ) => Effect.Effect<ProjectCreateWithBriefResult, ProjectBriefError>;
    readonly update: (
      input: ProjectUpdateBriefInput,
    ) => Effect.Effect<ProjectBrief, ProjectBriefError>;
  }
>()("t3/project/ProjectBriefService") {}

const make = Effect.gen(function* () {
  const folders = yield* ManagedProjectFolders.ManagedProjectFolders;
  const projects = yield* ProjectService.ProjectService;
  const settings = yield* ServerSettings.ServerSettingsService;
  const launches = yield* ThreadLaunch.ThreadLaunchService;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const crypto = yield* Crypto.Crypto;

  const fail =
    (operation: ProjectBriefError["operation"], detail: string) =>
    (cause: unknown): ProjectBriefError =>
      new ProjectBriefError({ operation, detail, cause });

  const newId = crypto.randomUUIDv4().pipe(Effect.mapError(fail("create-project", "No id.")));

  // Only folders T3 Code created itself get the file; a user's own repository
  // keeps its AGENTS.md untouched.
  const isManagedFolder = (workspaceRoot: string) => {
    const relative = path.relative(folders.namedProjectsRoot, path.resolve(workspaceRoot));
    return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  };

  const writeBriefFile = Effect.fn("ProjectBriefService.writeBriefFile")(function* (
    workspaceRoot: string,
    name: string,
    brief: ProjectBrief,
  ) {
    if (!isManagedFolder(workspaceRoot)) return;
    const agentsPath = path.join(workspaceRoot, "AGENTS.md");
    const claudePath = path.join(workspaceRoot, "CLAUDE.md");
    const existing = yield* fileSystem
      .readFileString(agentsPath)
      .pipe(Effect.orElseSucceed((): string | null => null));
    yield* fileSystem.writeFileString(
      agentsPath,
      withProjectBriefSection(existing, name, renderProjectBriefSection(name, brief)),
    );
    // Claude reads CLAUDE.md, the other providers AGENTS.md.
    if (!(yield* fileSystem.exists(claudePath))) {
      yield* fileSystem.writeFileString(claudePath, "@AGENTS.md\n");
    }
  });

  const resolveContext = Effect.fn("ProjectBriefService.resolveContext")(function* (
    paths: ReadonlyArray<string>,
  ) {
    const unique = [...new Set(paths.map((entry) => path.resolve(entry)))];
    return yield* Effect.forEach(unique, (entryPath) =>
      fileSystem.stat(entryPath).pipe(
        Effect.mapError(fail("read-context", `${entryPath} was not found on this environment.`)),
        Effect.map((info): ProjectContextEntry => ({
          path: entryPath,
          kind: info.type === "Directory" ? "directory" : "file",
        })),
      ),
    );
  });

  const saveBrief = (projectId: ProjectId, brief: ProjectBrief) =>
    settings
      .updateSettings({ projectBriefs: { [projectId]: brief } })
      .pipe(Effect.mapError(fail("save-brief", "The project brief could not be saved.")));

  const create: ProjectBriefService["Service"]["create"] = Effect.fn("ProjectBriefService.create")(
    function* (input) {
      const context = yield* resolveContext(input.contextPaths);
      const created = yield* folders
        .createNamedProject({ name: input.name })
        .pipe(Effect.mapError((cause) => fail("create-project", cause.message)(cause)));
      const { projectId, workspaceRoot } = created;
      const id = yield* newId;
      if (input.projectIcon !== null) {
        yield* projects
          .update({
            commandId: CommandId.make(`project-brief-icon:${id}`),
            projectId,
            projectIcon: input.projectIcon,
          })
          .pipe(Effect.mapError(fail("set-icon", "The project icon could not be set.")));
      }
      const draft: ProjectBrief = {
        goal: input.goal,
        context,
        coordinatorThreadId: null,
      };
      yield* writeBriefFile(workspaceRoot, input.name, draft).pipe(
        Effect.mapError(fail("write-brief-file", "AGENTS.md could not be written.")),
      );
      const current = yield* settings.getSettings.pipe(
        Effect.mapError(fail("launch-coordinator", "Settings could not be read.")),
      );
      const coordinatorThreadId = ThreadId.make(`${PROJECT_COORDINATOR_THREAD_ID_PREFIX}${id}`);
      // Saved before the launch so the thread is recognised as the coordinator
      // from its first event on.
      yield* saveBrief(projectId, { ...draft, coordinatorThreadId });
      yield* launches
        .launch({
          commandId: CommandId.make(`project-coordinator:${id}`),
          threadId: coordinatorThreadId,
          projectId,
          title: COORDINATOR_THREAD_TITLE,
          modelSelection: COORDINATOR_MODEL_SELECTION,
          runtimeMode: current.defaultRuntimeMode,
          interactionMode: "default",
          workspaceStrategy: { type: "root" },
          initialMessage: {
            text: coordinatorBriefing({
              name: input.name,
              goal: input.goal,
              threadModel: current.defaultModelSelection,
            }),
            attachments: [],
          },
          createdBy: "agent",
          creationSource: "server",
        })
        .pipe(
          Effect.mapError((cause) =>
            fail(
              "launch-coordinator",
              cause._tag === "ThreadManagementProviderInstanceDisabledError"
                ? "Claude is turned off on this environment, so the coordinator could not start."
                : "The coordinator thread could not start.",
            )(cause),
          ),
        );
      return { projectId, workspaceRoot, coordinatorThreadId };
    },
  );

  const update: ProjectBriefService["Service"]["update"] = Effect.fn("ProjectBriefService.update")(
    function* (input) {
      const project = yield* projects.getById(input.projectId).pipe(
        Effect.mapError(fail("read-project", "The project could not be read.")),
        Effect.flatMap(
          Option.match({
            onNone: () => Effect.fail(fail("read-project", "The project was not found.")(null)),
            onSome: Effect.succeed,
          }),
        ),
      );
      const current = yield* settings.getSettings.pipe(
        Effect.mapError(fail("save-brief", "Settings could not be read.")),
      );
      const previous = current.projectBriefs[input.projectId] ?? {
        goal: "",
        context: [],
        coordinatorThreadId: null,
      };
      const next: ProjectBrief = {
        ...previous,
        ...(input.goal === undefined ? {} : { goal: input.goal }),
        ...(input.contextPaths === undefined
          ? {}
          : { context: yield* resolveContext(input.contextPaths) }),
      };
      yield* saveBrief(input.projectId, next);
      yield* writeBriefFile(project.workspaceRoot, project.title, next).pipe(
        Effect.mapError(fail("write-brief-file", "AGENTS.md could not be written.")),
      );
      return next;
    },
  );

  return ProjectBriefService.of({ create, update });
});

export const layer = Layer.effect(ProjectBriefService, make);
