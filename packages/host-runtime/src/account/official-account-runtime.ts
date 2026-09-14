import type { JsonObject, JsonValue } from "@codexhost/protocol-core";

import type {
  OfficialClientSession,
  OfficialRuntimeOwner,
} from "../codex-runtime/official-runtime-owner.js";
import { OfficialAdmissionError } from "../codex-runtime/official-work-gate.js";
import {
  sameCodexCredentialIdentity,
  type CodexCredentialIdentity,
  type NativeCodexCredentials,
} from "./native-codex-credentials.js";
import type { NativeAccountRuntime } from "./native-account-runtime.js";

const object = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const managementInitialization = {
  clientInfo: { name: "codexhost_account_management", version: "1" },
  capabilities: { experimentalApi: true },
};
export class OfficialAccountVerificationError extends Error {
  constructor(
    readonly code:
      | "unsupported-version"
      | "unsupported-storage"
      | "authentication-failed"
      | "invalid-native-response",
  ) {
    super(`Codex Account ${code}`);
    this.name = "OfficialAccountVerificationError";
  }
}

type AccountRuntimeOwner = Pick<
  OfficialRuntimeOwner,
  "gate" | "running" | "start" | "stop" | "attachManagement" | "controlRequest"
>;

/** Native account operations. No refresh client, provider substitution or model inference. */
export class OfficialAccountRuntime implements NativeAccountRuntime {
  readonly #owner: AccountRuntimeOwner;
  readonly #sharedCodexHome: string;
  readonly #readCredentials: (home: string) => Promise<NativeCodexCredentials | null>;
  readonly #environment: NodeJS.ProcessEnv;
  readonly #reconcile: () => Promise<void>;
  readonly #stopExternalProcesses: () => Promise<void>;
  readonly #control: OfficialClientSession;
  readonly #listeners = new Set<(value: JsonValue) => void>();
  #activeHome: string | undefined;

  constructor(input: {
    owner: AccountRuntimeOwner;
    sharedCodexHome: string;
    readCredentials(home: string): Promise<NativeCodexCredentials | null>;
    environment?: NodeJS.ProcessEnv;
    /** Reject recorded historical writers whose exit cannot be established, including orphans. */
    reconcilePreviousWriter(): Promise<void>;
    stopExternalProcesses(): Promise<void>;
  }) {
    this.#owner = input.owner;
    this.#sharedCodexHome = input.sharedCodexHome;
    this.#readCredentials = input.readCredentials;
    this.#environment = input.environment ?? {};
    this.#reconcile = input.reconcilePreviousWriter;
    this.#stopExternalProcesses = input.stopExternalProcesses;
    if (input.owner.running) this.#activeHome = input.sharedCodexHome;
    this.#control = input.owner.attachManagement(async ({ value }) => {
      for (const listener of this.#listeners) {
        try {
          listener(value);
        } catch {
          /* management subscribers are isolated */
        }
      }
    });
    this.#control.configure(managementInitialization);
  }

  get gate() {
    return this.#owner.gate;
  }

  async preflight(): Promise<void> {
    if (!this.#owner.running) await this.reconcilePreviousWriter();
    if (this.#owner.running) {
      await this.#configuration();
      await this.#authenticationMode();
      return;
    }
    if (this.#owner.gate.phase === "ready") throw new OfficialAdmissionError("unavailable");
    try {
      // Existing Desktop clients remain attached but are not initialized or resumed here.
      await this.#owner.start({ mode: "management-only" });
      this.#activeHome = this.#sharedCodexHome;
      await this.#configuration();
      await this.#authenticationMode();
    } catch (error) {
      // A failed cold probe cannot leave an unverified writer behind. A successful
      // probe remains available until the coordinator explicitly stops it.
      await this.stop();
      throw error;
    }
  }

  async #authenticationMode(): Promise<void> {
    const response = await this.#read("account/read", { refreshToken: true });
    if (
      response.account !== null &&
      (!object(response.account) || response.account.type !== "chatgpt")
    )
      throw new OfficialAccountVerificationError("unsupported-storage");
  }

  /** Collection is optional; failure here must not stop an already running backend. */
  async checkCredentialStorage(): Promise<void> {
    await this.#configuration();
  }

  async #configuration(): Promise<void> {
    const response = await this.#read("config/read", { includeLayers: true });
    if (!object(response.config))
      throw new OfficialAccountVerificationError("invalid-native-response");
    if (response.config.cli_auth_credentials_store !== "file")
      throw new OfficialAccountVerificationError("unsupported-storage");
    const overrides = new Set([
      "OPENAI_API_KEY",
      "CODEX_API_KEY",
      "CODEX_AUTH_TOKEN",
      "CODEX_ACCESS_TOKEN",
    ]);
    if (
      Object.entries(this.#environment).some(
        ([key, value]) => overrides.has(key.toUpperCase()) && !!value,
      )
    )
      throw new OfficialAccountVerificationError("unsupported-storage");
  }

  async stopExternalProcesses(): Promise<void> {
    if (this.#owner.running) throw new OfficialAdmissionError("busy");
    await this.#stopExternalProcesses();
  }

  async stop(): Promise<void> {
    await this.#owner.stop();
    this.#activeHome = undefined;
  }
  async reconcilePreviousWriter(): Promise<void> {
    if (this.#owner.running) throw new OfficialAdmissionError("busy");
    await this.#reconcile();
  }
  async start(stagingHome?: string): Promise<void> {
    const wasRunning = this.#owner.running;
    try {
      await this.#owner.start(
        stagingHome === undefined
          ? { mode: "task" }
          : { homeOverride: stagingHome, mode: "management-only" },
      );
      this.#activeHome = stagingHome ?? this.#sharedCodexHome;
      // Never admit an unknown credential store merely because recovery reached start().
      await this.#configuration();
      await this.#authenticationMode();
    } catch (error) {
      if (!wasRunning) await this.stop();
      throw error;
    }
  }

  async controlRequest(method: string, params: JsonObject): Promise<JsonObject> {
    await this.#control.initialize(managementInitialization);
    return this.#owner.controlRequest(method, params);
  }

  async verify(identity: CodexCredentialIdentity | null): Promise<void> {
    await this.#configuration();
    const home = this.#activeHome;
    if (!home) throw new OfficialAccountVerificationError("invalid-native-response");
    const before = await this.#safeReadCredentials(home);
    if (identity === null) {
      const response = await this.#read("account/read", { refreshToken: true });
      if (before !== null || response.account !== null)
        throw new OfficialAccountVerificationError("authentication-failed");
      return;
    }
    if (!before || !sameCodexCredentialIdentity(before.identity, identity))
      throw new OfficialAccountVerificationError("authentication-failed");
    // Let native account/read handle refresh, then verify the resulting file identity.
    // Quota availability is not an Account readiness or credential-commit condition.
    const account = await this.#read("account/read", { refreshToken: true });
    const after = await this.#safeReadCredentials(home);
    if (
      !after ||
      !sameCodexCredentialIdentity(after.identity, identity) ||
      !object(account.account) ||
      account.account.type !== "chatgpt"
    )
      throw new OfficialAccountVerificationError("authentication-failed");
  }

  subscribe(listener: (value: JsonValue) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async #read(method: string, params: JsonObject): Promise<JsonObject> {
    let result: JsonObject;
    try {
      result = await this.controlRequest(method, params);
    } catch {
      throw new OfficialAccountVerificationError("invalid-native-response");
    }
    if (result.error || !object(result.result))
      throw new OfficialAccountVerificationError("invalid-native-response");
    return result.result;
  }

  async #safeReadCredentials(home: string): Promise<NativeCodexCredentials | null> {
    try {
      return await this.#readCredentials(home);
    } catch {
      // Native readers can encounter secret-bearing parser/storage errors. Never
      // retain them as a cause or interpolate them into a public error.
      throw new OfficialAccountVerificationError("invalid-native-response");
    }
  }
}
