import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nativeSessionRefSchema } from "@codexhost/shared-contracts";
import { forkCursorSession } from "../src/fork.js";
import type * as forkSupport from "../src/fork-support.js";
import { cursorTailCheckpoint } from "../src/fork-support.js";
import { cursorConfigDirectory, readCursorNativeTurns } from "../src/native-history.js";
import { runCursorForkTerminal } from "../src/fork-terminal.js";

vi.mock("../src/fork-terminal.js", () => ({ runCursorForkTerminal: vi.fn() }));
vi.mock("../src/fork-support.js", async (original) => ({
  ...(await original<typeof forkSupport>()),
  cursorForkAvailable: () => true,
}));
const roots: string[] = [];
afterEach(async () => {
  vi.resetAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
function field(id: number, value: Buffer | string): Buffer {
  const data = Buffer.from(value);
  return Buffer.concat([Buffer.from([id * 8 + 2, data.length]), data]);
}
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "cursor-fork-test-"));
  roots.push(root);
  const config = path.join(root, "config"),
    id = randomUUID(),
    turnId = randomUUID();
  const source = path.join(config, "acp-sessions", id);
  await mkdir(source, { recursive: true });
  await writeFile(path.join(source, "meta.json"), JSON.stringify({ cwd: root }));
  const db = new DatabaseSync(path.join(source, "store.db"));
  db.exec(
    "CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT); CREATE TABLE blobs(id TEXT PRIMARY KEY,data BLOB)",
  );
  const put = (data: Buffer) => {
    const hash = createHash("sha256").update(data).digest();
    db.prepare("INSERT INTO blobs VALUES(?,?)").run(hash.toString("hex"), data);
    return hash;
  };
  const rootBlob = put(
    field(8, put(field(1, field(1, put(Buffer.concat([field(1, "hello"), field(2, turnId)])))))),
  );
  db.prepare("INSERT INTO meta VALUES('0',?)").run(
    Buffer.from(
      JSON.stringify({ agentId: id, latestRootBlobId: rootBlob.toString("hex") }),
    ).toString("hex"),
  );
  db.close();
  const sourceRef = nativeSessionRefSchema.parse({
    harnessId: "cursor-cli",
    nativeSessionId: id,
    formatVersion: 1,
  });
  const options = { cwd: root, environment: { CURSOR_CONFIG_DIR: config } };
  return {
    root,
    source,
    id,
    turnId,
    sourceRef,
    options,
    checkpoint: cursorTailCheckpoint(id, turnId),
  };
}
async function nativeCopy(
  options: { cwd: string; environment: NodeJS.ProcessEnv },
  id: string,
  corrupt = false,
) {
  const root = path.join(
    cursorConfigDirectory(options.environment),
    "chats",
    createHash("md5")
      .update(await realpath(options.cwd))
      .digest("hex"),
  );
  roots.push(path.dirname(cursorConfigDirectory(options.environment)));
  const target = randomUUID();
  const { cp } = await import("node:fs/promises");
  await cp(path.join(root, id), path.join(root, target), { recursive: true });
  const db = new DatabaseSync(path.join(root, target, "store.db"));
  const value = db.prepare("SELECT value FROM meta").get()?.value;
  if (typeof value !== "string") throw new Error("Fixture metadata missing");
  const metadata = JSON.parse(Buffer.from(value, "hex").toString());
  metadata.agentId = target;
  db.prepare("UPDATE meta SET value=?").run(Buffer.from(JSON.stringify(metadata)).toString("hex"));
  if (corrupt) db.prepare("DELETE FROM blobs WHERE id=?").run(metadata.latestRootBlobId);
  db.close();
  return target;
}
describe("Cursor native fork transaction", () => {
  it("copies a consistent store, verifies native identity, and removes temporary staging", async () => {
    const f = await fixture();
    const before = await readFile(path.join(f.source, "store.db"));
    let staging = "";
    vi.mocked(runCursorForkTerminal).mockImplementation(async (options, id) => {
      staging = path.dirname(cursorConfigDirectory(options.environment));
      await nativeCopy(options, id);
    });
    const result = await forkCursorSession(
      f.sourceRef,
      f.checkpoint,
      f.options,
      new AbortController().signal,
    );
    expect(result.sessionId).not.toBe(f.id);
    expect(readCursorNativeTurns(result.sessionId, f.root, f.options.environment)).toEqual([
      { id: f.turnId, text: "hello" },
    ]);
    expect(await readFile(path.join(f.source, "store.db"))).toEqual(before);
    await expect(readdir(staging)).rejects.toThrow();
    result.commit();
    await result.discard();
    expect(readCursorNativeTurns(result.sessionId, f.root, f.options.environment)).toHaveLength(1);
  });
  it("discards the new session if ACP adoption fails", async () => {
    const f = await fixture();
    vi.mocked(runCursorForkTerminal).mockImplementation(async (options, id) => {
      await nativeCopy(options, id);
    });
    const result = await forkCursorSession(
      f.sourceRef,
      f.checkpoint,
      f.options,
      new AbortController().signal,
    );
    await result.discard();
    expect(await readdir(path.dirname(f.source))).toEqual([f.id]);
  });
  it("rejects corrupted native copies and cleans temporary state", async () => {
    const f = await fixture();
    let staging = "";
    vi.mocked(runCursorForkTerminal).mockImplementation(async (options, id) => {
      staging = path.dirname(cursorConfigDirectory(options.environment));
      await nativeCopy(options, id, true);
    });
    await expect(
      forkCursorSession(f.sourceRef, f.checkpoint, f.options, new AbortController().signal),
    ).rejects.toThrow("changed conversation");
    await expect(readdir(staging)).rejects.toThrow();
    expect(await readdir(path.dirname(f.source))).toEqual([f.id]);
  });
  it("rejects wrong ownership and stale boundaries before launching CLI", async () => {
    const f = await fixture();
    await expect(
      forkCursorSession(
        f.sourceRef,
        cursorTailCheckpoint(randomUUID(), f.turnId),
        f.options,
        new AbortController().signal,
      ),
    ).rejects.toThrow("checkpoint");
    await expect(
      forkCursorSession(
        f.sourceRef,
        cursorTailCheckpoint(f.id, randomUUID()),
        f.options,
        new AbortController().signal,
      ),
    ).rejects.toThrow("last turn");
    expect(runCursorForkTerminal).not.toHaveBeenCalled();
  });
  it("cleans up when the terminal fails or the operation is aborted", async () => {
    const f = await fixture();
    let staging = "";
    vi.mocked(runCursorForkTerminal).mockImplementation(async (options) => {
      staging = path.dirname(cursorConfigDirectory(options.environment));
      throw new Error("terminal failed");
    });
    await expect(
      forkCursorSession(f.sourceRef, f.checkpoint, f.options, new AbortController().signal),
    ).rejects.toThrow("terminal failed");
    await expect(readdir(staging)).rejects.toThrow();
    const controller = new AbortController();
    controller.abort();
    await expect(
      forkCursorSession(f.sourceRef, f.checkpoint, f.options, controller.signal),
    ).rejects.toThrow();
    expect(await readdir(path.dirname(f.source))).toEqual([f.id]);
  });
});
