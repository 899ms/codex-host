import { mkdir, chmod } from "node:fs/promises";
import path from "node:path";
import { Writable } from "node:stream";
import { z } from "zod";
import { CodexRuntime } from "../codex-runtime/codex-runtime.js";
import { spawnOfficialAppServerConnection } from "../official-app-server-connection.js";
import { NativeAccountError, writePrivateFile } from "./native-account-store.js";
const nonBlank = z
  .string()
  .min(1)
  .max(1_024)
  .refine((value) => value.trim().length > 0);
export const nativeDeviceCodeLoginResponseSchema = z.object({
  type: z.literal("chatgptDeviceCode"),
  loginId: nonBlank,
  verificationUrl: z
    .string()
    .url()
    .max(16_384)
    .refine((value) => {
      const url = new URL(value);
      return (
        !url.username &&
        !url.password &&
        ["https://auth.openai.com", "https://chatgpt.com"].includes(url.origin)
      );
    }),
  userCode: nonBlank,
});
export interface DeviceCodeLogin {
  verificationUrl: string;
  userCode: string;
  completed: Promise<boolean>;
  close(): Promise<void>;
}
export type StartDeviceCodeLogin = (home: string) => Promise<DeviceCodeLogin>;
export function createDeviceCodeLogin(input: {
  stockCodexPath: string;
  environment: NodeJS.ProcessEnv;
}): StartDeviceCodeLogin {
  return async (home) => {
    await mkdir(home, { recursive: true, mode: 0o700 });
    await chmod(home, 0o700);
    await writePrivateFile(
      path.join(home, "config.toml"),
      'cli_auth_credentials_store = "file"\n[features]\nplugins = false\n',
    );
    const allowed = new Set([
      "HOME",
      "USERPROFILE",
      "SYSTEMROOT",
      "WINDIR",
      "PATH",
      "TMP",
      "TEMP",
      "TMPDIR",
      "LANG",
      "LC_ALL",
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "ALL_PROXY",
      "NO_PROXY",
      "SSL_CERT_FILE",
      "SSL_CERT_DIR",
    ]);
    const completion = Promise.withResolvers<boolean>();
    let loginId: string | undefined;
    const early: Array<{ loginId: string; success: boolean }> = [];
    const runtime = new CodexRuntime({
      generation: 1,
      connection: spawnOfficialAppServerConnection({
        stockCodexPath: input.stockCodexPath,
        arguments: ["app-server"],
        cwd: home,
        environment: {
          ...Object.fromEntries(
            Object.entries(input.environment).filter(([key]) => allowed.has(key.toUpperCase())),
          ),
          CODEX_HOME: home,
        },
      }),
      diagnosticOutput: new Writable({
        write(_chunk, _encoding, done) {
          done();
        },
      }),
      onClosed: () => completion.resolve(false),
      onOutput: async ({ value }) => {
        if (
          !value ||
          typeof value !== "object" ||
          Array.isArray(value) ||
          value.method !== "account/login/completed"
        )
          return;
        const parsed = z
          .object({ loginId: z.string(), success: z.boolean() })
          .safeParse(value.params);
        if (!parsed.success) return;
        if (loginId === undefined) early.push(parsed.data);
        else if (parsed.data.loginId === loginId) completion.resolve(parsed.data.success);
      },
    });
    let closing: Promise<void> | undefined;
    const close = (): Promise<void> =>
      (closing ??= runtime.stopProcess().then(() => {
        completion.resolve(false);
      }));
    try {
      const initialized = await runtime.request("initialize", {
        clientInfo: { name: "codexhost_account_login", version: "1" },
        capabilities: { experimentalApi: true },
      });
      if (initialized.error) throw new NativeAccountError("authentication-failed");
      await runtime.send({ method: "initialized", params: {} });
      const response = await runtime.request("account/login/start", { type: "chatgptDeviceCode" });
      if (response.error) throw new NativeAccountError("authentication-failed");
      const result = nativeDeviceCodeLoginResponseSchema.parse(response.result);
      loginId = result.loginId;
      for (const event of early) if (event.loginId === loginId) completion.resolve(event.success);
      return {
        verificationUrl: result.verificationUrl,
        userCode: result.userCode,
        completed: completion.promise,
        close,
      };
    } catch {
      await close();
      throw new NativeAccountError("authentication-failed");
    }
  };
}
