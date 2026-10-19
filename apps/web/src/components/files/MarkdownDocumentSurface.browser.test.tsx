import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

const { saveChange, setFileData, startTurn } = vi.hoisted(() => ({
  saveChange: vi.fn(),
  setFileData: vi.fn(),
  startTurn: vi.fn(),
}));
vi.mock(import("./useFileSaveCoordinator"), () => ({
  useFileSaveCoordinator: () => ({ change: saveChange }),
}));
vi.mock(import("./projectFilesQueryState"), async (original) => ({
  ...(await original()),
  getOptimisticProjectFileQueryData: () => null,
  setProjectFileQueryData: setFileData,
}));
vi.mock(import("~/state/entities"), async (original) => ({
  ...(await original()),
  useThreadShell: (() => ({
    providerInstanceId: "claude",
    runtimeMode: "full-access",
    interactionMode: "default",
  })) as never,
}));
vi.mock(import("~/state/use-orchestration-command"), async (original) => ({
  ...(await original()),
  useOrchestrationCommand: (() => startTurn) as never,
}));

import { MarkdownDocumentSurface } from "./MarkdownDocumentSurface";

const environmentId = EnvironmentId.make("markdown-document");
const threadRef = { environmentId, threadId: ThreadId.make("thread-1") };
const contents = "# Plan\n\nDe groeimotor is de docent, niet de schoolleider.\n";

let root: Root | null = null;
let host: HTMLDivElement;

async function mount() {
  host = document.createElement("div");
  host.style.cssText = "width: 1200px; height: 800px; display: flex;";
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root!.render(
      <StrictMode>
        <MarkdownDocumentSurface
          environmentId={environmentId}
          cwd="/workspace"
          relativePath="plan.md"
          contents={contents}
          threadRef={threadRef}
          draft={false}
          readOnly={false}
          onPendingChange={() => {}}
        />
      </StrictMode>,
    ),
  );
}

async function selectText(text: string) {
  const editor = host.querySelector<HTMLElement>(".ProseMirror")!;
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const index = node.textContent!.indexOf(text);
    if (index === -1) continue;
    editor.focus();
    const range = document.createRange();
    range.setStart(node, index);
    range.setEnd(node, index + text.length);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    return;
  }
  throw new Error(`No text ${text}`);
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  saveChange.mockReset();
  setFileData.mockReset();
  startTurn.mockReset().mockResolvedValue(AsyncResult.success(undefined));
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  host.remove();
});

describe("MarkdownDocumentSurface", () => {
  it("comments on selected text and sends the comment to the agent", async () => {
    await mount();
    await selectText("de docent");

    const toolbar = host.querySelector("[data-markdown-toolbar]");
    expect(toolbar).not.toBeNull();
    await act(async () =>
      toolbar!.querySelector<HTMLButtonElement>('[aria-label="Comment"]')!.click(),
    );

    const field = host.querySelector<HTMLTextAreaElement>("textarea")!;
    expect(field).not.toBeNull();
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )!.set!;
      setValue.call(field, "Klopt dit?");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () =>
      host.querySelector<HTMLButtonElement>('[aria-label="Send comment"]')!.click(),
    );

    const written = saveChange.mock.calls.at(-1)?.[0] as string | undefined;
    expect(written).toContain("<!-- t3code:comments");
    expect(written).toContain('"quote": "de docent"');
    expect(written).toContain('"body": "Klopt dit?"');
    expect(startTurn).toHaveBeenCalledTimes(1);
  });

  it("formats selected text from the toolbar and saves it as markdown", async () => {
    await mount();
    await selectText("schoolleider");

    await act(async () =>
      host
        .querySelector("[data-markdown-toolbar]")!
        .querySelector<HTMLButtonElement>('[aria-label="Bold"]')!
        .click(),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    expect(saveChange.mock.calls.at(-1)?.[0]).toBe(
      "# Plan\n\nDe groeimotor is de docent, niet de **schoolleider**.\n",
    );
  });
});
