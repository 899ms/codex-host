import { afterEach, expect, it, vi } from "vitest";
import { PassThrough, Writable } from "node:stream";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type {
  OfficialAppServerConnection,
  OfficialAppServerExit,
} from "../src/official-app-server-connection.js";
vi.mock("../src/official-app-server-connection.js", () => ({
  spawnOfficialAppServerConnection: vi.fn(),
}));
import { spawnOfficialAppServerConnection } from "../src/official-app-server-connection.js";
import { createDeviceCodeLogin } from "../src/account/native-device-code-login.js";
const homes: string[] = [];
afterEach(async () => {
  vi.resetAllMocks();
  await Promise.all(homes.splice(0).map((home) => rm(home, { recursive: true, force: true })));
});
async function setup(early: boolean) {
  const home = await mkdtemp(path.join(tmpdir(), "device-login-test-"));
  homes.push(home);
  const stdout = new PassThrough(),
    stderr = new PassThrough(),
    closed = Promise.withResolvers<OfficialAppServerExit>();
  const requests: string[] = [];
  const send = (value: unknown) => stdout.write(`${JSON.stringify(value)}\n`);
  const completion = () =>
    send({ method: "account/login/completed", params: { loginId: "native-id", success: true } });
  const stopProcess = vi.fn(async () => {
    const result = { code: 0, signal: null };
    closed.resolve(result);
    stdout.end();
    return result;
  });
  const connection: OfficialAppServerConnection = {
    stdout,
    stderr,
    closed: closed.promise,
    close() {},
    stopProcess,
    stdin: new Writable({
      write(chunk, _encoding, done) {
        for (const line of String(chunk).trim().split("\n")) {
          const request = JSON.parse(line);
          requests.push(request.method);
          if (request.method === "initialize") send({ id: request.id, result: {} });
          if (request.method === "account/login/start") {
            if (early) completion();
            send({
              id: request.id,
              result: {
                type: "chatgptDeviceCode",
                loginId: "native-id",
                verificationUrl: "https://auth.openai.com/device",
                userCode: "CODE",
              },
            });
          }
        }
        done();
      },
    }),
  };
  vi.mocked(spawnOfficialAppServerConnection).mockReturnValue(connection);
  const session = await createDeviceCodeLogin({
    stockCodexPath: "/fake/codex",
    environment: {
      PATH: "/bin",
      HOME: "/home/user",
      OPENAI_API_KEY: "not-forwarded",
      CODEX_HOME: "/permanent",
      OTHER_SECRET: "not-forwarded",
    },
  })(home);
  return { home, session, requests, stopProcess, completion, closed };
}
it("buffers completion before login/start response and isolates environment", async () => {
  const { home, session, requests, stopProcess } = await setup(true);
  await expect(session.completed).resolves.toBe(true);
  expect(requests).toEqual(["initialize", "initialized", "account/login/start"]);
  expect(vi.mocked(spawnOfficialAppServerConnection).mock.calls[0]?.[0]).toEqual({
    stockCodexPath: "/fake/codex",
    arguments: ["app-server"],
    cwd: home,
    environment: { PATH: "/bin", HOME: "/home/user", CODEX_HOME: home },
  });
  expect(await readFile(path.join(home, "config.toml"), "utf8")).toBe(
    'cli_auth_credentials_store = "file"\n[features]\nplugins = false\n',
  );
  await Promise.all([session.close(), session.close()]);
  expect(stopProcess).toHaveBeenCalledOnce();
});
it("process close resolves unsuccessful completion", async () => {
  const { session, closed } = await setup(false);
  closed.resolve({ code: 1, signal: null });
  await expect(session.completed).resolves.toBe(false);
  await session.close();
});
