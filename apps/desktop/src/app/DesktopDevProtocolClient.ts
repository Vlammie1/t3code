// Windows starts a protocol client with only the registered command line, so a
// link opened from the shell reaches the dev app without the dev runner's
// environment. The dev server URL travels as a flag instead: it decides that
// the process is development, and with it the profile and its single-instance
// lock, so the link reaches the running dev app through `second-instance`.
const DEV_SERVER_URL_FLAG = "--t3code-dev-server-url=";

export function devProtocolClientArgs(input: {
  readonly dirname: string;
  readonly joinPath: (...segments: ReadonlyArray<string>) => string;
  readonly devServerUrl: URL;
}): ReadonlyArray<string> {
  // Mirrors the command line of scripts/dev-electron.mjs, with an absolute entry
  // because the shell starts the client from another directory.
  return [
    `--t3code-dev-root=${input.joinPath(input.dirname, "..")}`,
    input.joinPath(input.dirname, "main.cjs"),
    `${DEV_SERVER_URL_FLAG}${input.devServerUrl.href}`,
  ];
}

export const isDevProtocolClientLaunch = (argv: ReadonlyArray<string>): boolean =>
  argv.some((value) => value.startsWith(DEV_SERVER_URL_FLAG));

/** Must run before the desktop config is read. */
export function restoreDevServerUrl(argv: ReadonlyArray<string>, env: NodeJS.ProcessEnv): void {
  if (env.VITE_DEV_SERVER_URL?.trim()) return;
  const flag = argv.find((value) => value.startsWith(DEV_SERVER_URL_FLAG));
  if (flag !== undefined) env.VITE_DEV_SERVER_URL = flag.slice(DEV_SERVER_URL_FLAG.length);
}
