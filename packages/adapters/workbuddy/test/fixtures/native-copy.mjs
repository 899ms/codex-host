#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

process.on("uncaughtException", (error) => {
  if (process.env.COPY_INVOCATION_LOG)
    appendFileSync(process.env.COPY_INVOCATION_LOG, `ERROR ${error.stack || error}\n`);
  process.exit(4);
});

const args = process.argv.slice(2);
const value = (name) => args[args.indexOf(name) + 1];
const sourceId = value("--resume");
const targetId = value("--session-id");
if (
  !sourceId ||
  !targetId ||
  !args.includes("--fork-session") ||
  args.includes("--acp") ||
  args.includes("/fork")
)
  process.exit(2);

let input = "";
process.stdin.on("data", (data) => (input += data));
process.stdin.on("end", () => {
  if (input) process.exit(3);
  const root = process.env.WORKBUDDY_CONFIG_DIR || process.env.CODEBUDDY_CONFIG_DIR;
  const slug = path
    .resolve(process.cwd())
    .replace(/[^a-z0-9]/giu, "-")
    .replace(/-+/gu, "-")
    .replace(/^-|-$/gu, "")
    .toLowerCase();
  const directory = path.join(root, "projects", slug);
  mkdirSync(directory, { recursive: true });
  const source = readFileSync(path.join(directory, `${sourceId}.jsonl`), "utf8");
  writeFileSync(
    path.join(directory, `${targetId}.jsonl`),
    source + JSON.stringify({ type: "session-meta", sessionId: targetId }) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  if (process.env.COPY_INVOCATION_LOG)
    appendFileSync(
      process.env.COPY_INVOCATION_LOG,
      JSON.stringify({ cwd: process.cwd(), args }) + "\n",
    );
  process.stdout.write(
    JSON.stringify({ type: "system", subtype: "init", session_id: targetId }) + "\n",
  );
  process.stdout.write(
    JSON.stringify({
      type: "result",
      is_error: false,
      session_id: targetId,
      duration_api_ms: 0,
    }) + "\n",
  );
});
