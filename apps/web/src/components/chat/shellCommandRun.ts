import { createContext } from "react";

/** Runs a shell command in the thread's terminal; null where no thread can run it. */
export const ShellCommandRunContext = createContext<((command: string) => void) | null>(null);
