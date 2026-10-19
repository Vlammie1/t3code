import {
  CommandId,
  MessageId,
  ThreadId,
  type TerminalError,
  type TerminalRunCommandInput,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ThreadManagementService from "../orchestration-v2/ThreadManagementService.ts";
import {
  completionSentinel,
  completionSentinelPattern,
  observeTerminalCompletion,
  resolveCompletionShell,
  wrapCommandForCompletion,
} from "../project/ProjectSetupScriptRunner.ts";
import * as TerminalManager from "./Manager.ts";

const OUTPUT_MAX_LINES = 120;

export class ThreadCommandRunner extends Context.Service<
  ThreadCommandRunner,
  {
    /**
     * Starts the command in a new terminal of the thread and returns once it is typed in. The
     * terminal stays open so the user can read it.
     */
    readonly run: (input: TerminalRunCommandInput) => Effect.Effect<void, TerminalError>;
  }
>()("t3/terminal/ThreadCommandRunner") {}

export function failedCommandMessage(input: {
  readonly command: string;
  readonly exitCode: number;
  readonly output: ReadonlyArray<string>;
}): string {
  const output = input.output.length > 0 ? `\n${input.output.join("\n")}` : "";
  return [
    `I ran this command from the chat and it failed with exit code ${input.exitCode}:`,
    "",
    "```shell",
    `$ ${input.command}${output}`,
    "```",
  ].join("\n");
}

export const make = Effect.gen(function* () {
  const terminalManager = yield* TerminalManager.TerminalManager;
  const threadManagement = yield* ThreadManagementService.ThreadManagementService;
  const crypto = yield* Crypto.Crypto;
  const completionShell = resolveCompletionShell(
    yield* HostProcess.Platform,
    yield* HostProcess.Environment,
  );
  const serviceScope = yield* Effect.scope;

  // A success says nothing; a failure is something the agent can act on.
  const reportFailure = (input: TerminalRunCommandInput, exitCode: number, output: string[]) =>
    Effect.gen(function* () {
      const threadId = ThreadId.make(input.threadId);
      const thread = yield* threadManagement.getThreadShell(threadId);
      if (thread === null) return;
      const id = yield* crypto.randomUUIDv4();
      yield* threadManagement.sendToThread({
        projectId: thread.projectId,
        commandId: CommandId.make(`terminal-command:${id}`),
        threadId,
        messageId: MessageId.make(`terminal-command-message:${id}`),
        text: failedCommandMessage({ command: input.command, exitCode, output }),
        attachments: [],
        mode: "auto",
        createdBy: "user",
        creationSource: "server",
      });
    });

  const run: ThreadCommandRunner["Service"]["run"] = Effect.fn("ThreadCommandRunner.run")(
    function* (input) {
      const token = (yield* crypto.randomUUIDv4().pipe(Effect.orDie)).replaceAll("-", "");
      const sentinel = completionSentinel(token);
      const commandLine = wrapCommandForCompletion(input.command, completionShell, sentinel);
      yield* terminalManager.open({
        threadId: input.threadId,
        terminalId: input.terminalId,
        cwd: input.cwd,
        ...(input.worktreePath === undefined ? {} : { worktreePath: input.worktreePath }),
        ...(input.env === undefined ? {} : { env: input.env }),
      });
      const output: string[] = [];
      // Subscribe before writing so the sentinel cannot race past the listener.
      const observed = yield* observeTerminalCompletion(terminalManager, {
        threadId: input.threadId,
        terminalId: input.terminalId,
        sentinel,
        sentinelPattern: completionSentinelPattern(token),
        echoedWrapperLines: commandLine.split("\r").filter((line) => line.length > 0),
        onOutputLine: (line) =>
          Effect.sync(() => {
            output.push(line);
            if (output.length > OUTPUT_MAX_LINES) output.shift();
          }),
      });
      yield* terminalManager
        .write({ threadId: input.threadId, terminalId: input.terminalId, data: `${commandLine}\r` })
        .pipe(Effect.tapError(() => Effect.sync(() => observed.unsubscribe())));
      // A null exit code means the terminal closed first: the user stopped it.
      yield* observed.completion.pipe(
        Effect.flatMap(({ exitCode }) =>
          exitCode === null || exitCode === 0
            ? Effect.void
            : reportFailure(input, exitCode, output),
        ),
        Effect.ignoreCause({ log: true }),
        Effect.forkIn(serviceScope),
      );
    },
  );

  return ThreadCommandRunner.of({ run });
});

export const layer = Layer.effect(ThreadCommandRunner, make);
