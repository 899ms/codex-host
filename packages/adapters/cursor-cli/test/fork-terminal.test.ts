import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, it } from "vitest";
import { runCursorForkTerminal } from "../src/fork-terminal.js";
import { cursorForkAvailable } from "../src/fork-support.js";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(discover = true) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "cursor-fork-terminal-"));
  roots.push(cwd);
  const command = path.join(cwd, "cursor fixture");
  await writeFile(
    command,
    `#!${process.execPath}
const fs = require('node:fs');
fs.writeFileSync('pid', String(process.pid));
fs.writeFileSync('size', JSON.stringify([process.stdout.columns, process.stdout.rows]));
process.stdin.setRawMode(true);
process.stdin.resume();
process.stdout.write('Add a follow-up');
let received = '';
process.stdin.on('data', chunk => {
 received += chunk.toString();
 fs.appendFileSync('input', chunk);
 if (received === '/fork' && ${discover}) process.stdout.write('Fork the current chat into a new session');
 if (received === '/fork\\r') process.stdout.write('This conversation has been forked.');
});
`,
    { mode: 0o700 },
  );
  return { cwd, command, environment: process.env, timeoutMs: 10_000 };
}
it.skipIf(!cursorForkAvailable())(
  "drives the native command only after discovery and terminates the PTY process",
  async () => {
    const options = await fixture();
    await runCursorForkTerminal(
      options,
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
      new AbortController().signal,
    );
    expect(await readFile(path.join(options.cwd, "input"), "utf8")).toBe("/fork\r");
    expect(JSON.parse(await readFile(path.join(options.cwd, "size"), "utf8"))).toEqual([140, 40]);
    const pid = Number(await readFile(path.join(options.cwd, "pid"), "utf8"));
    await expect
      .poll(() => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      })
      .toBe(false);
  },
);
it.skipIf(!cursorForkAvailable())("closes the owned terminal when cancelled", async () => {
  const options = await fixture(false);
  const controller = new AbortController();
  const pending = runCursorForkTerminal(
    options,
    "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    controller.signal,
  );
  const finished = pending.then(
    () => undefined,
    (error: unknown) => error,
  );
  try {
    await expect
      .poll(async () => readFile(path.join(options.cwd, "input"), "utf8").catch(() => ""), {
        timeout: 4_000,
      })
      .toBe("/fork");
    controller.abort();
    expect(await finished).toMatchObject({ message: "Cursor fork cancelled" });
  } finally {
    controller.abort();
    await finished;
  }
  const pid = Number(await readFile(path.join(options.cwd, "pid"), "utf8"));
  await expect
    .poll(() => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    })
    .toBe(false);
});
it.skipIf(!cursorForkAvailable())(
  "does not press Enter when the native command is unavailable",
  async () => {
    const options = await fixture(false);
    options.timeoutMs = 2_000;
    await expect(
      runCursorForkTerminal(
        options,
        "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
        new AbortController().signal,
      ),
    ).rejects.toThrow("timed out");
    expect(await readFile(path.join(options.cwd, "input"), "utf8")).toBe("/fork");
  },
);
