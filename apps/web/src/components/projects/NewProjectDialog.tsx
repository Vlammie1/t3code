import {
  squashAtomCommandFailure,
  isAtomCommandInterrupted,
} from "@t3tools/client-runtime/state/runtime";
import {
  type EnvironmentId,
  PROJECT_BRIEF_GOAL_MAX_LENGTH,
  type ProjectIconOverride,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { FolderIcon } from "~/components/appIcons";
import { deriveProjectIdentity } from "~/projectIdentity";
import { projectEnvironment } from "~/state/projects";
import { useAtomCommand } from "~/state/use-atom-command";
import { ProjectFavicon } from "../ProjectFavicon";
import { ProjectMonogram } from "../ProjectMonogram";
import { ProjectIconPickerDialog } from "../settings/ProjectIconPickerDialog";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import { stackedThreadToast, toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ProjectContextEditor } from "./ProjectContextEditor";
import { mergeContextPaths } from "./projects.logic";

export function NewProjectDialog({
  environmentId,
  canPickFolder,
  open,
  onOpenChange,
}: {
  readonly environmentId: EnvironmentId;
  readonly canPickFolder: boolean;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const createWithBrief = useAtomCommand(projectEnvironment.createWithBrief, {
    reportFailure: false,
  });
  const [name, setName] = useState("");
  const [goal, setGoal] = useState("");
  const [contextPaths, setContextPaths] = useState<ReadonlyArray<string>>([]);
  const [icon, setIcon] = useState<ProjectIconOverride | null>(null);
  const [pickingIcon, setPickingIcon] = useState(false);
  const [creating, setCreating] = useState(false);
  const trimmedName = name.trim();
  const identity = deriveProjectIdentity(trimmedName || "Project");

  const reset = () => {
    setName("");
    setGoal("");
    setContextPaths([]);
    setIcon(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (trimmedName === "" || creating) return;
    setCreating(true);
    const result = await createWithBrief({
      environmentId,
      input: { name: trimmedName, projectIcon: icon, goal: goal.trim(), contextPaths },
    });
    setCreating(false);
    if (result._tag === "Failure") {
      if (!isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add(
          stackedThreadToast({
            type: "error",
            title: "Could not create the project",
            description: error instanceof Error ? error.message : "An error occurred.",
          }),
        );
      }
      return;
    }
    onOpenChange(false);
    reset();
    void navigate({
      to: "/projects/$environmentId/$projectId",
      params: { environmentId, projectId: result.value.projectId },
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !creating && onOpenChange(next)}>
      <DialogPopup className="w-full sm:w-[34rem]">
        <form onSubmit={(event) => void submit(event)} className="contents">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
          </DialogHeader>
          <DialogPanel>
            <div className="flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <Label htmlFor="new-project-name">Name</Label>
                <InputGroup>
                  <InputGroupAddon>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            aria-label="Choose icon"
                            onClick={() => setPickingIcon(true)}
                          />
                        }
                      >
                        {icon === null && trimmedName === "" ? (
                          <FolderIcon className="size-4 text-icon-muted" />
                        ) : icon === null ? (
                          <ProjectMonogram
                            text={identity.monogram}
                            color={identity.color}
                            className="size-4"
                          />
                        ) : (
                          <ProjectFavicon
                            project={{
                              environmentId,
                              workspaceRoot: "",
                              title: trimmedName,
                              faviconPath: null,
                              projectIcon: icon,
                            }}
                            className="size-4"
                          />
                        )}
                      </TooltipTrigger>
                      <TooltipPopup side="top">Choose icon</TooltipPopup>
                    </Tooltip>
                  </InputGroupAddon>
                  <InputGroupInput
                    id="new-project-name"
                    autoFocus
                    autoComplete="off"
                    value={name}
                    maxLength={200}
                    placeholder="API performance"
                    onChange={(event) => setName(event.currentTarget.value)}
                  />
                </InputGroup>
              </div>

              <div className="flex flex-col gap-2">
                <Label htmlFor="new-project-goal">
                  Goal <span className="font-normal text-muted-foreground">(optional)</span>
                </Label>
                <Textarea
                  id="new-project-goal"
                  value={goal}
                  maxLength={PROJECT_BRIEF_GOAL_MAX_LENGTH}
                  placeholder="Bring p95 latency under 200 ms across the whole API"
                  onChange={(event) => setGoal(event.currentTarget.value)}
                />
              </div>

              <ProjectContextEditor
                rows={contextPaths.map((path) => ({ path }))}
                canPickFolder={canPickFolder}
                optional
                disabled={creating}
                onAdd={(paths) => setContextPaths((current) => mergeContextPaths(current, paths))}
                onRemove={(path) =>
                  setContextPaths((current) => current.filter((entry) => entry !== path))
                }
              />
            </div>
          </DialogPanel>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={creating}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={trimmedName === "" || creating}>
              {creating ? "Creating…" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
        <ProjectIconPickerDialog
          current={icon}
          projectName={trimmedName || "Project"}
          open={pickingIcon}
          onOpenChange={setPickingIcon}
          onSelect={setIcon}
        />
      </DialogPopup>
    </Dialog>
  );
}
