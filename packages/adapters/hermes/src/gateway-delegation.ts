import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

export const HERMES_DELEGATION_GUIDANCE = `This Session runs inside codexhost.
When the user authorizes cross-Harness delegation, discover the executable named by CODEXHOST_CLI_PATH through your native terminal tool. Read its --help and harness list, then use delegate start and thread send/read/wait/cancel as documented. Prefer --format compact. Preserve CODEXHOST_RUNTIME_ENDPOINT, CODEXHOST_RUNTIME_TOKEN and CODEXHOST_THREAD_ID in these calls: they identify the Runtime and parent Thread. Never print their values or substitute another executable. Native Hermes delegate_task remains available for Hermes subagents.`;
const required = [
  "CODEXHOST_CLI_PATH",
  "CODEXHOST_RUNTIME_ENDPOINT",
  "CODEXHOST_RUNTIME_TOKEN",
  "CODEXHOST_THREAD_ID",
];

/** Native TUI skill preload supplies an ephemeral system-prompt addition. */
export async function prepareGatewayDelegation(
  python: string,
  cwd: string,
  environment: NodeJS.ProcessEnv,
): Promise<{ environment: NodeJS.ProcessEnv; dispose(): Promise<void> }> {
  if (!required.every((key) => environment[key])) return { environment, dispose: async () => {} };
  const result = await promisify(execFile)(
    python,
    ["-I", "-c", "from hermes_constants import get_hermes_home\nprint(get_hermes_home())"],
    { cwd, env: { ...process.env, ...environment }, timeout: 20000, maxBuffer: 1024 * 1024 },
  );
  const home = result.stdout.trim();
  if (!path.isAbsolute(home)) throw new Error("Hermes did not resolve its active profile home");
  const skills = path.join(home, "skills");
  await mkdir(skills, { recursive: true });
  const directory = await mkdtemp(path.join(skills, "codexhost-runtime-"));
  const name = path.basename(directory);
  try {
    await writeFile(
      path.join(directory, "SKILL.md"),
      `---\nname: ${name}\ndescription: Discover authorized codexhost agent collaboration.\n---\n\n${HERMES_DELEGATION_GUIDANCE}\n`,
      { mode: 0o600 },
    );
    return {
      environment: {
        ...environment,
        HERMES_TUI_SKILLS: [environment.HERMES_TUI_SKILLS, name].filter(Boolean).join(","),
      },
      dispose: () => rm(directory, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
