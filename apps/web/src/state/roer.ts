import { RegistryContext, useAtomValue } from "@effect/atom-react";
import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import type {
  EnvironmentId,
  RoerThreadLocation,
  RoerThreadPlacement,
  ServerSettings,
  ThreadId,
} from "@t3tools/contracts";
import { Atom, type AtomRegistry } from "effect/reactivity";
import { useContext, useEffect, useEffectEvent } from "react";

import { serverEnvironment } from "./server";

/**
 * Where a thread runs when its environment is linked to Roer: here, or on Roer's cloud worker. Shared per thread so
 * the chat header, the sidebar menu, the command palette and the banner over the composer agree.
 */

type Registry = AtomRegistry.AtomRegistry;
type ThreadRef = { readonly environmentId: EnvironmentId; readonly threadId: ThreadId };
type RoerThreadState = { readonly placement: RoerThreadPlacement | null; readonly moving: boolean };

const EMPTY: RoerThreadState = { placement: null, moving: false };

const roerThreadAtom = Atom.family((_key: string) =>
  Atom.make<RoerThreadState>(EMPTY).pipe(Atom.keepAlive, Atom.withLabel("web-roer-thread")),
);
const atomFor = (ref: ThreadRef | null) =>
  roerThreadAtom(ref === null ? "" : `${ref.environmentId}:${ref.threadId}`);

const NO_SETTINGS_ATOM = Atom.make<ServerSettings | null>(null).pipe(
  Atom.withLabel("web-roer-thread:no-settings"),
);
const settingsAtomFor = (environmentId: EnvironmentId | null) =>
  environmentId === null ? NO_SETTINGS_ATOM : serverEnvironment.settingsValueAtom(environmentId);

// A move can also start from the phone, so the chat checks back now and then while it is open and visible.
const POLL_MS = 60_000;

export interface RoerThreadView {
  /** False when this environment has no Roer link; then there is nothing to offer. */
  readonly configured: boolean;
  /** Null until Roer has answered. */
  readonly location: RoerThreadLocation | null;
  readonly moving: boolean;
  readonly jobUrl: string | null;
}

const view = (settings: ServerSettings | null, state: RoerThreadState): RoerThreadView => {
  const configured = !!settings?.roer.url;
  return {
    configured,
    location: configured ? (state.placement?.location ?? null) : null,
    moving: state.moving,
    jobUrl: state.placement?.jobUrl ?? null,
  };
};

export function readRoerThread(registry: Registry, ref: ThreadRef): RoerThreadView {
  return view(registry.get(settingsAtomFor(ref.environmentId)), registry.get(atomFor(ref)));
}

export async function refreshRoerThread(registry: Registry, ref: ThreadRef): Promise<void> {
  if (!readRoerThread(registry, ref).configured) return;
  const result = await runAtomCommand(
    registry,
    serverEnvironment.roerThreadPlacement,
    { environmentId: ref.environmentId, input: { threadId: ref.threadId } },
    {
      label: serverEnvironment.roerThreadPlacement.label,
      reportFailure: false,
      reportDefect: true,
    },
  );
  const atom = atomFor(ref);
  if (result._tag === "Success")
    registry.set(atom, { ...registry.get(atom), placement: result.value });
}

/** Moves the thread; Roer's reason for refusing (local changes since, the laptop offline) surfaces as a failure. */
export async function moveRoerThread(
  registry: Registry,
  ref: ThreadRef,
  to: RoerThreadLocation,
): Promise<boolean> {
  const atom = atomFor(ref);
  if (!readRoerThread(registry, ref).configured || registry.get(atom).moving) return false;
  registry.set(atom, { ...registry.get(atom), moving: true });
  const result = await runAtomCommand(
    registry,
    serverEnvironment.roerMoveThread,
    { environmentId: ref.environmentId, input: { threadId: ref.threadId, to } },
    { label: serverEnvironment.roerMoveThread.label, reportFailure: true, reportDefect: true },
  );
  registry.set(atom, {
    placement: result._tag === "Success" ? result.value : registry.get(atom).placement,
    moving: false,
  });
  return result._tag === "Success";
}

export const moveToastTitle = (to: RoerThreadLocation) =>
  to === "cloud" ? "Thread moved to the cloud" : "Thread is back on this machine";

export interface RoerThread extends RoerThreadView {
  readonly refresh: () => Promise<void>;
  readonly move: (to: RoerThreadLocation) => Promise<boolean>;
}

export function useRoerThread(
  environmentId: EnvironmentId | null,
  threadId: ThreadId | null,
): RoerThread {
  const registry = useContext(RegistryContext);
  const ref = environmentId !== null && threadId !== null ? { environmentId, threadId } : null;
  const settings = useAtomValue(settingsAtomFor(environmentId));
  const state = useAtomValue(atomFor(ref));
  const current = view(ref === null ? null : settings, state);
  return {
    ...current,
    refresh: () => (ref === null ? Promise.resolve() : refreshRoerThread(registry, ref)),
    move: (to) => (ref === null ? Promise.resolve(false) : moveRoerThread(registry, ref, to)),
  };
}

/** Keeps the placement of the open thread current; mount it once, where the thread is shown. */
export function useRoerPlacementPolling(roer: RoerThread, threadKey: string | null): void {
  const poll = useEffectEvent(() => void roer.refresh());
  const { configured } = roer;
  useEffect(() => {
    if (!configured || threadKey === null) return;
    poll();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") poll();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [configured, threadKey]);
}
