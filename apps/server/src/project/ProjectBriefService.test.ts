import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import { ProjectId, type Project } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";

import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as ManagedProjectFolders from "./ManagedProjectFolders.ts";
import * as ProjectBriefService from "./ProjectBriefService.ts";
import * as ProjectService from "./ProjectService.ts";

const projectId = ProjectId.make("project-brief-test");
const unused = Effect.die("not used by this test");

const makeLayer = (input: {
  readonly namedProjectsRoot: string;
  readonly workspaceRoot: string;
  readonly launches?: Array<ThreadLaunch.ThreadLaunchInput>;
}) => {
  const project: Project = {
    id: projectId,
    title: "API performance",
    workspaceRoot: input.workspaceRoot,
    defaultModelSelection: null,
    scripts: [],
    createdAt: "2026-10-19T00:00:00.000Z",
    updatedAt: "2026-10-19T00:00:00.000Z",
    deletedAt: null,
  };
  return ProjectBriefService.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(
          ManagedProjectFolders.ManagedProjectFolders,
          ManagedProjectFolders.ManagedProjectFolders.of({
            scratchRoot: Effect.succeed(Option.none()),
            ensureScratchProject: unused,
            folderForThread: () => Effect.succeed(Option.none()),
            namedProjectsRoot: input.namedProjectsRoot,
            createNamedProject: () =>
              Effect.succeed({ projectId, workspaceRoot: input.workspaceRoot }),
          }),
        ),
        Layer.succeed(
          ProjectService.ProjectService,
          ProjectService.ProjectService.of({
            create: () => unused,
            bootstrap: () => unused,
            update: () => Effect.succeed(project),
            delete: () => unused,
            getById: (id) =>
              Effect.succeed(id === projectId ? Option.some(project) : Option.none()),
            getByWorkspaceRoot: () => Effect.succeed(Option.none()),
            snapshot: unused,
            getShell: () => Effect.succeed(Option.none()),
            listShells: () => Effect.succeed([]),
          }),
        ),
        Layer.succeed(
          ThreadLaunch.ThreadLaunchService,
          ThreadLaunch.ThreadLaunchService.of({
            // The launch result is never read, so the stub records the input and stops there.
            launch: (launch) =>
              Effect.sync(() => {
                input.launches?.push(launch);
              }).pipe(Effect.andThen(unused)),
            checkWorktreeBase: () => unused,
            retryPreparation: () => unused,
            prepareRun: () => unused,
          }),
        ),
      ),
    ),
    Layer.provideMerge(ServerSettings.ServerSettingsService.layerTest()),
  );
};

const tempDir = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3code-project-brief-" });
});

describe("ProjectBriefService.create", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect("starts the coordinator on the coordinator model with the project brief", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* tempDir;
        const workspaceRoot = path.join(root, "api-performance");
        yield* fileSystem.makeDirectory(workspaceRoot);
        const launches: Array<ThreadLaunch.ThreadLaunchInput> = [];

        const saved = yield* Effect.gen(function* () {
          const briefs = yield* ProjectBriefService.ProjectBriefService;
          yield* briefs
            .create({
              name: "API performance",
              projectIcon: null,
              goal: "Bring p95 latency under 200 ms",
              contextPaths: [],
            })
            .pipe(Effect.exit);
          const settings = yield* ServerSettings.ServerSettingsService;
          return (yield* settings.getSettings).projectBriefs[projectId];
        }).pipe(Effect.provide(makeLayer({ namedProjectsRoot: root, workspaceRoot, launches })));

        expect(launches).toHaveLength(1);
        const [launch] = launches;
        expect(launch?.modelSelection).toEqual(ProjectBriefService.COORDINATOR_MODEL_SELECTION);
        expect(launch?.title).toBe(ProjectBriefService.COORDINATOR_THREAD_TITLE);
        expect(launch?.creationSource).toBe("server");
        expect(launch?.initialMessage?.text).toContain("short plan for the goal");
        expect(saved?.coordinatorThreadId).toBe(launch?.threadId);
        expect(saved?.goal).toBe("Bring p95 latency under 200 ms");
        expect(yield* fileSystem.readFileString(path.join(workspaceRoot, "AGENTS.md"))).toContain(
          "Bring p95 latency under 200 ms",
        );
      }),
    );
  });
});

describe("ProjectBriefService.update", () => {
  it.layer(NodeServices.layer)((it) => {
    it.effect("mirrors the brief into a managed folder and keeps notes outside its section", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* tempDir;
        const workspaceRoot = path.join(root, "api-performance");
        const contextDir = path.join(root, "api");
        const contextFile = path.join(root, "notes.md");
        yield* fileSystem.makeDirectory(workspaceRoot);
        yield* fileSystem.makeDirectory(contextDir);
        yield* fileSystem.writeFileString(contextFile, "# Notes\n");
        yield* fileSystem.writeFileString(
          path.join(workspaceRoot, "AGENTS.md"),
          "# API performance\n\nKeep answers short.\n",
        );

        const brief = yield* Effect.gen(function* () {
          const briefs = yield* ProjectBriefService.ProjectBriefService;
          yield* briefs.update({ projectId, goal: "First goal", contextPaths: [contextDir] });
          return yield* briefs.update({
            projectId,
            goal: "Bring p95 latency under 200 ms",
            contextPaths: [contextDir, contextFile, contextDir],
          });
        }).pipe(Effect.provide(makeLayer({ namedProjectsRoot: root, workspaceRoot })));

        expect(brief.goal).toBe("Bring p95 latency under 200 ms");
        expect(brief.context).toEqual([
          { path: contextDir, kind: "directory" },
          { path: contextFile, kind: "file" },
        ]);
        const agents = yield* fileSystem.readFileString(path.join(workspaceRoot, "AGENTS.md"));
        expect(agents.startsWith("# API performance\n\nKeep answers short.\n")).toBe(true);
        expect(agents).toContain("Bring p95 latency under 200 ms");
        expect(agents).not.toContain("First goal");
        expect(agents.match(/<!-- t3:project-brief -->/g)).toHaveLength(1);
        expect(yield* fileSystem.readFileString(path.join(workspaceRoot, "CLAUDE.md"))).toBe(
          "@AGENTS.md\n",
        );
      }),
    );

    it.effect("leaves a folder outside the managed projects root untouched", () =>
      Effect.gen(function* () {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* tempDir;
        const workspaceRoot = path.join(root, "own-repo");
        yield* fileSystem.makeDirectory(workspaceRoot);

        yield* Effect.gen(function* () {
          const briefs = yield* ProjectBriefService.ProjectBriefService;
          yield* briefs.update({ projectId, goal: "Ship it" });
        }).pipe(
          Effect.provide(
            makeLayer({ namedProjectsRoot: path.join(root, "projects"), workspaceRoot }),
          ),
        );

        expect(yield* fileSystem.exists(path.join(workspaceRoot, "AGENTS.md"))).toBe(false);
      }),
    );

    it.effect("refuses a context path that does not exist", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const root = yield* tempDir;
        const missing = path.join(root, "missing");

        const error = yield* Effect.gen(function* () {
          const briefs = yield* ProjectBriefService.ProjectBriefService;
          return yield* briefs.update({ projectId, contextPaths: [missing] }).pipe(Effect.flip);
        }).pipe(Effect.provide(makeLayer({ namedProjectsRoot: root, workspaceRoot: root })));

        expect(error.operation).toBe("read-context");
        expect(error.message).toContain(missing);
      }),
    );
  });
});
