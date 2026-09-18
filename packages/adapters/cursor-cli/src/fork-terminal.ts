import { spawn } from "node:child_process";
import { cursorInvocation } from "./command.js";
import type { CursorTransportOptions } from "./transport.js";

const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;

/** Run only the native interactive /fork command. Never forward terminal output to Host. */
export async function runCursorForkTerminal(
  options: CursorTransportOptions,
  sessionId: string,
  signal: AbortSignal,
): Promise<void> {
  signal.throwIfAborted();
  const invocation = cursorInvocation(options.environment, options.command, [
    "--trust",
    "--resume",
    sessionId,
  ]);
  // script inherits a 0x0 terminal from a headless Host. Set the actual PTY size,
  // not just COLUMNS/LINES, before Cursor computes its interactive layout.
  const command = [
    "/bin/sh",
    "-c",
    'stty rows 40 cols 140 && exec "$@"',
    "cursor-fork-pty",
    invocation.command,
    ...invocation.arguments,
  ];
  const args =
    process.platform === "darwin"
      ? ["-q", "/dev/null", ...command]
      : ["-q", "-f", "-c", command.map(quote).join(" "), "/dev/null"];
  // BSD script rejects Node's socketpair stdin. cat supplies a real Unix pipe;
  // argv stays positional so command paths and arguments never become shell code.
  const child = spawn("/bin/sh", ["-c", 'cat | /usr/bin/script "$@"', "cursor-fork", ...args], {
    cwd: options.cwd,
    env: { ...options.environment, TERM: "xterm-256color", COLUMNS: "140", LINES: "40" },
    stdio: "pipe",
    detached: true,
  });
  child.stderr.resume();
  child.stdin.on("error", () => {});
  let state: "loading" | "selecting" | "submitted" = "loading";
  let tail = "";
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        if (error) reject(error);
        else resolve();
      };
      const abort = () => finish(new Error("Cursor fork cancelled"));
      const timer = setTimeout(
        () => finish(new Error("Cursor native /fork timed out")),
        options.timeoutMs ?? 60_000,
      );
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
      child.once("error", () => finish(new Error("Cursor fork terminal could not start")));
      child.once("exit", () => finish(new Error("Cursor fork terminal exited before completion")));
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (data: string) => {
        if (settled) return;
        // Bound the buffer; ANSI and terminal redraws are not a protocol or a transcript.
        tail = (tail + data).slice(-64_000);
        const plain = tail.replace(/\x1b\[[0-?]*[ -/]*[@-~]/gu, "");
        if (state === "loading" && plain.includes("Add a follow-up")) {
          state = "selecting";
          tail = "";
          child.stdin.write("/fork");
        } else if (
          state === "selecting" &&
          plain.includes("Fork the current chat into a new session")
        ) {
          // Wait for native command discovery before Enter: never submit /fork as a model prompt.
          state = "submitted";
          tail = "";
          child.stdin.write("\r");
        } else if (state === "submitted" && plain.includes("This conversation has been forked.")) {
          finish();
        } else if (
          plain.includes("Failed to fork the conversation:") ||
          plain.includes("Nothing to fork yet.")
        ) {
          finish(new Error("Cursor rejected the native fork"));
        }
      });
    });
  } finally {
    child.stdin.destroy();
    if (child.pid) {
      // script and its PTY child belong exclusively to this operation.
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }
    child.stdout.destroy();
    child.stderr.destroy();
    if (child.exitCode === null && child.signalCode === null)
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2_000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
  }
}
