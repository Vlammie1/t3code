import type { EnvironmentId } from "@t3tools/contracts";

import { writeTextToClipboard } from "../../hooks/useCopyToClipboard";
import { useRemoteOpenResolution } from "../../remoteOpen";
import { projectEnvironment } from "../../state/projects";
import { shellEnvironment } from "../../state/shell";
import { useAtomCommand } from "../../state/use-atom-command";
import { useAtomQueryRunner } from "../../state/use-atom-query-runner";
import { toastManager } from "../ui/toast";

/**
 * Copies a file the way a file manager does, so it pastes as a file into
 * Explorer, Finder, mail or a chat app. Only a file on this machine can go on
 * this clipboard; for another machine's file its text is copied instead.
 */
export function useCopyFile(environmentId: EnvironmentId | null) {
  const openInEditor = useAtomCommand(shellEnvironment.openInEditor, { reportFailure: false });
  const readFile = useAtomQueryRunner(projectEnvironment.readFile, { reportFailure: false });
  const remoteOpen = useRemoteOpenResolution(environmentId);
  const onThisMachine = remoteOpen.isResolved && remoteOpen.state.mode === "local-exec";

  return async (input: { readonly cwd: string; readonly absolutePath: string }) => {
    if (environmentId === null) return;
    if (onThisMachine) {
      const copied = await openInEditor({
        environmentId,
        input: { cwd: input.absolutePath, editor: "file-manager", copyToClipboard: true },
      });
      if (copied._tag === "Success") {
        toastManager.add({
          type: "success",
          title: "File copied",
          description: input.absolutePath,
        });
        return;
      }
    }
    const read = await readFile({
      environmentId,
      input: { cwd: input.cwd, relativePath: input.absolutePath },
    });
    if (read._tag !== "Success") {
      toastManager.add({
        type: "error",
        title: "Could not copy file",
        description: input.absolutePath,
      });
      return;
    }
    await writeTextToClipboard(read.value.contents);
    toastManager.add({
      type: "success",
      title: "Contents copied",
      description: onThisMachine
        ? "This machine cannot copy files to the clipboard, so the text was copied."
        : "The file is on another machine, so its text was copied.",
    });
  };
}
