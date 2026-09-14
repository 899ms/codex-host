import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { prepareLocalCodex, type PreparedLocalCodex } from "../src/native-account-host.js";
import { OfficialRuntimeClient } from "../src/codex-runtime/official-runtime-scope.js";

const stock = process.env.CODEXHOST_TEST_OFFICIAL_CODEX;
const launcher = process.env.CODEXHOST_TEST_NATIVE_LAUNCHER;

// Opt-in real native composition, denying external HTTP, no credentials, keyring,
// authentication completion, inference or application-wide process termination.
describe.skipIf(!stock || !launcher)("isolated real ordinary startup", () => {
  it.each(["clean", "broken-vault", "missing-receipt", "existing-writer"])(
    "keeps official requests available: %s",
    async (scenario) => {
      if (!stock || !launcher) throw new Error("Explicit native executables are required");
      const root = await realpath(await mkdtemp(path.join(tmpdir(), "codexhost-startup-probe-")));
      const home = path.join(root, "codex");
      const directory = path.join(home, ".codexhost-native-accounts");
      await mkdir(directory, { recursive: true, mode: 0o700 });
      await writeFile(
        path.join(home, "config.toml"),
        'cli_auth_credentials_store = "file"\n[features]\nplugins = false\n',
        { mode: 0o600 },
      );
      if (scenario === "broken-vault")
        await writeFile(path.join(directory, "vault.json"), "malformed collection", {
          mode: 0o600,
        });
      const historical = JSON.stringify({
        version: 1,
        nonce: randomUUID(),
        phase: "running",
        pid: 2_000_000_000,
        identity: "isolated-historical-fixture",
      });
      if (scenario === "missing-receipt")
        await writeFile(path.join(directory, ".codexhost-process.json"), historical, {
          mode: 0o600,
        });
      const environment: NodeJS.ProcessEnv = {
        HOME: root,
        USERPROFILE: root,
        CODEX_HOME: home,
        CODEXHOST_DATA_DIR: path.join(root, "data"),
        CODEXHOST_LAUNCHER_EXECUTABLE: launcher,
        PATH: path.dirname(stock),
        TMPDIR: tmpdir(),
        TMP: tmpdir(),
        TEMP: tmpdir(),
        ...(process.env.SYSTEMROOT ? { SYSTEMROOT: process.env.SYSTEMROOT } : {}),
        HTTP_PROXY: "http://127.0.0.1:9",
        HTTPS_PROXY: "http://127.0.0.1:9",
        ALL_PROXY: "http://127.0.0.1:9",
        NO_PROXY: "localhost,127.0.0.1",
      };
      const input = {
        stockCodexPath: stock,
        arguments: ["app-server"],
        environment,
        sharedListener: true,
        diagnosticOutput: new Writable({
          write(_chunk, _encoding, done) {
            done();
          },
        }),
      };
      let existing: PreparedLocalCodex | undefined;
      let prepared: PreparedLocalCodex | undefined;
      let client: OfficialRuntimeClient | undefined;
      try {
        if (scenario === "existing-writer") {
          existing = await prepareLocalCodex(input);
          await existing.accountControl.refresh?.();
        }
        prepared = await prepareLocalCodex(input);
        expect(prepared.officialRuntimeScope.owner.generation).toBe(1);
        expect(prepared.officialRuntimeScope.gate.phase).toBe("ready");
        client = new OfficialRuntimeClient({
          scope: prepared.officialRuntimeScope,
          output: async () => {},
        });
        await client.initialize();
        const initialized = await client.initializeProtocol({
          clientInfo: { name: "codexhost_startup_test", version: "1" },
        });
        expect(initialized.error).toBeUndefined();
        await expect(
          client.request("account/read", { refreshToken: false }),
        ).resolves.toMatchObject({ result: { account: null } });
        const models = await client.request("model/list", {});
        expect(models.error).toBeUndefined();
        expect(models.result).toBeDefined();
        await prepared.accountControl.refresh?.();
        expect(prepared.officialRuntimeScope.gate.phase).toBe("ready");
        expect(prepared.officialRuntimeScope.owner.generation).toBe(1);
        expect(prepared.accountControl.snapshot().capabilities.manage).toBe(
          !["broken-vault", "existing-writer"].includes(scenario),
        );
        if (existing) expect(existing.officialRuntimeScope.owner.running).toBe(true);
        if (scenario === "missing-receipt")
          expect(await readFile(path.join(directory, ".codexhost-process.json"), "utf8")).toBe(
            historical,
          );
      } finally {
        await client?.close();
        await prepared?.close();
        await existing?.close();
        await rm(root, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
