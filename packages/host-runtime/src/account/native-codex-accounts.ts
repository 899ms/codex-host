import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import path from "node:path";
import type { Writable } from "node:stream";
import {
  NativeAccountDiagnostics,
  type AccountDiagnosticStep,
} from "./native-account-diagnostics.js";
import type {
  AccountCreditsSnapshot,
  CodexAccountListResult,
  CodexAccountLoginCompleted,
  CodexAccountLoginStartResult,
  CodexAccountUsageResult,
} from "@codexhost/shared-contracts";
import {
  OfficialAdmissionError,
  type OfficialChangeLease,
} from "../codex-runtime/official-work-gate.js";
import type { CodexAccountControl } from "./codex-account-control.js";
import type { NativeAccountRuntime } from "./native-account-runtime.js";
import {
  NativeAccountError,
  type NativeAccountStore,
  type NativeAccountVault,
} from "./native-account-store.js";
import { NativeAccountQuotas } from "./native-account-quotas.js";
import {
  sameCodexCredentialIdentity,
  type NativeCodexCredentials,
} from "./native-codex-credentials.js";
import type { DeviceCodeLogin, StartDeviceCodeLogin } from "./native-device-code-login.js";
type Operation = NonNullable<CodexAccountListResult["pendingOperation"]>;
interface PendingLogin {
  operationId: string;
  accountId: string;
  requestedAccountId?: string;
  home: string;
  cancelled: boolean;
  saved: boolean;
  starting: Promise<void>;
  finishStart(): void;
  session?: DeviceCodeLogin;
  settling?: Promise<void>;
  timeout?: ReturnType<typeof setTimeout>;
}
/** Collection and credential replacement; native Codex remains the authentication authority. */
export class NativeCodexAccounts implements CodexAccountControl {
  readonly #store: NativeAccountStore;
  readonly #runtime: NativeAccountRuntime;
  readonly #quotas: NativeAccountQuotas;
  readonly #diagnostics: NativeAccountDiagnostics;
  readonly #startLogin: StartDeviceCodeLogin | undefined;
  readonly #instanceId = randomUUID();
  readonly #listeners = new Set<(event: CodexAccountLoginCompleted) => void>();
  #vault: NativeAccountVault = { version: 3, revision: 0, accounts: [] };
  #available = false;
  #initializing: Promise<void> | undefined;
  #pending: Operation | undefined;
  #login: PendingLogin | undefined;
  constructor(input: {
    store: NativeAccountStore;
    runtime: NativeAccountRuntime;
    startDeviceCodeLogin?: StartDeviceCodeLogin;
    fetch?: typeof fetch;
    diagnosticOutput?: Pick<Writable, "write">;
  }) {
    this.#store = input.store;
    this.#runtime = input.runtime;
    this.#diagnostics = new NativeAccountDiagnostics(
      input.store.directory,
      input.diagnosticOutput ?? process.stderr,
    );
    this.#startLogin = input.startDeviceCodeLogin;
    this.#quotas = new NativeAccountQuotas({
      directory: input.store.directory,
      credentials: input.store,
      ...(input.fetch ? { fetch: input.fetch } : {}),
      admitCredentialRefresh: (accountId) => {
        const release = this.#runtime.gate.admit("credential-write");
        if (accountId === this.currentAccountId()) {
          release();
          throw new NativeAccountError("credential-conflict");
        }
        return release;
      },
    });
  }
  snapshot(): CodexAccountListResult {
    if (this.#store.ready) this.#vault = this.#store.vault;
    const phase = this.#runtime.gate.phase,
      manage = this.#available;
    const idle = manage && !this.#pending && phase === "ready";
    const pendingOperation =
      this.#pending ??
      (this.#login ? { operationId: this.#login.operationId, kind: "login" as const } : undefined);
    return {
      version: 2,
      instanceId: this.#instanceId,
      currentAccountId: this.#store.currentAccountId,
      phase,
      revision:
        this.#runtime.gate.revision + this.#vault.revision + this.#store.observationRevision,
      ...(pendingOperation ? { pendingOperation } : {}),
      capabilities: {
        manage,
        switch: idle,
        login: idle && !this.#login && !!this.#startLogin,
        delete: idle,
        logout: idle,
        recover: !this.#pending && phase === "unavailable",
        ...(!manage
          ? { reason: "unsupported-storage" as const }
          : phase === "unavailable"
            ? { reason: "recovery-required" as const }
            : {}),
      },
      accounts: this.#vault.accounts.map(({ accountId, label, email, planType, auth }) => ({
        accountId,
        label,
        ...(email ? { email } : {}),
        ...(planType ? { planType } : {}),
        ...(auth === null ? { requiresLogin: true } : {}),
      })),
    };
  }
  currentAccountId(): string | null {
    return this.#store.currentAccountId;
  }
  initialize(): Promise<void> {
    return (this.#initializing ??= (async () => {
      this.#available = false;
      await this.#store.open();
      await this.#runtime.checkCredentialStorage();
      await this.#store.captureCurrent();
      this.#available = true;
      await this.#quotas
        .initialize(new Set(this.#store.vault.accounts.map((a) => a.accountId)))
        .catch(() => undefined);
    })().finally(() => {
      this.#initializing = undefined;
    }));
  }
  async refresh(): Promise<CodexAccountListResult> {
    await this.#initializing?.catch(() => undefined);
    if (!this.#available) await this.initialize().catch(() => undefined);
    else if (!this.#pending && this.#runtime.gate.phase === "ready") {
      await this.#store.captureCurrent();
    }
    return this.snapshot();
  }
  async #requireManagement(): Promise<void> {
    await this.#initializing;
    if (this.#pending) throw new OfficialAdmissionError("changing");
    if (!this.#available) throw new NativeAccountError("unsupported-storage");
  }
  #begin(kind: Operation["kind"], recovery = false, collection = false): OfficialChangeLease {
    if (this.#pending) throw new OfficialAdmissionError("changing");
    this.#pending = { operationId: randomUUID(), kind };
    try {
      return recovery
        ? this.#runtime.gate.beginChange(true)
        : collection
          ? this.#runtime.gate.beginCollectionChange()
          : this.#runtime.gate.beginStoppingChange();
    } catch (error) {
      this.#pending = undefined;
      throw error;
    }
  }
  #finish(change: OfficialChangeLease, ready: boolean): boolean {
    this.#pending = undefined;
    try {
      if (ready && this.#runtime.gate.phase === "unavailable") {
        change.finish("unavailable");
        this.#runtime.gate.beginChange(true).finish("ready");
      } else change.finish(ready ? "ready" : "unavailable");
    } catch {
      change.finish("unavailable");
      this.#runtime.gate.unavailable();
    }
    return this.#runtime.gate.phase === "ready";
  }
  switch(accountId: string): Promise<void> {
    return this.#changeCredential(accountId, "switch");
  }
  logout(): Promise<void> {
    return this.#changeCredential(null, "logout");
  }
  async #changeCredential(
    accountId: string | null,
    kind: "switch" | "logout",
    replacement?: NativeCodexCredentials,
  ): Promise<void> {
    const step = <T>(name: AccountDiagnosticStep, action: () => T | Promise<T>) =>
      this.#diagnostics.step(kind, name, action);
    await step("storage-check", () => this.#requireManagement());
    const change = await step("assert-idle", () => this.#begin(kind));
    let source: NativeCodexCredentials | null = null,
      stopping = false,
      stopped = false,
      installed = false;
    try {
      source = await step("capture", () => this.#store.captureCurrent());
      const account = await step("install", () => {
        const found =
          accountId === null
            ? null
            : this.#store.vault.accounts.find((a) => a.accountId === accountId);
        if (found === undefined) throw new NativeAccountError("unknown-account");
        return found;
      });
      if (
        replacement
          ? source?.serializeForNativeStore() === replacement.serializeForNativeStore()
          : account === null
            ? source === null
            : source && sameCodexCredentialIdentity(source.identity, account.identity)
      ) {
        this.#finish(change, true);
        return;
      }
      const target = await step(
        "install",
        () => replacement ?? (account ? this.#store.credential(account) : null),
      );
      await step("storage-check", () => this.#runtime.checkCredentialStorage());
      stopping = true;
      await step("stop", () => this.#runtime.stop());
      stopped = true;
      if (kind === "switch")
        await step("external-stop", () => this.#runtime.stopExternalProcesses());
      await step("assert-idle", () => change.assertIdle());
      source = await step("capture", () => this.#store.captureCurrent());
      installed = true;
      await step("install", () => this.#store.install(target));
      await step("start", () => this.#runtime.start());
      await step("verify-read", () => this.#runtime.verify(target?.identity ?? null));
      await step("capture", () => this.#store.captureCurrent()).catch(() => undefined);
      await step("assert-idle", () => {
        if (!this.#finish(change, true)) throw new NativeAccountError("switch-failed");
      });
    } catch (error) {
      let ready = !stopping && this.#runtime.gate.phase !== "unavailable";
      if (stopped) {
        try {
          if (installed) {
            await step("rollback-stop", () => this.#runtime.stop());
            await step("rollback-capture", () => this.#store.captureCurrent()).catch(
              () => undefined,
            );
            await step("rollback-install", () => this.#store.install(source));
          } else {
            // No Host write occurred: preserve any grant rotated during backend exit.
            source = await step("rollback-capture", () => this.#store.readCredentials());
          }
          await step("rollback-start", () => this.#runtime.start());
          await step("rollback-verify-read", () => this.#runtime.verify(source?.identity ?? null));
          ready = true;
        } catch {
          ready = false;
        }
      }
      this.#finish(change, ready);
      if (error instanceof NativeAccountError || error instanceof OfficialAdmissionError)
        throw error;
      throw new NativeAccountError("switch-failed");
    }
  }
  async recover(): Promise<void> {
    await this.#initializing?.catch(() => undefined);
    const step = <T>(name: AccountDiagnosticStep, action: () => T | Promise<T>) =>
      this.#diagnostics.step("recover", name, action);
    const change = await step("assert-idle", () => this.#begin("recovery", true));
    try {
      await step("stop", () => this.#runtime.stop());
      await step("start", () => this.#runtime.start());
      const current = await step("capture", () => this.#store.readCredentials());
      await step("verify-read", () => this.#runtime.verify(current?.identity ?? null));
      if (this.#store.ready) await step("capture", () => this.#store.captureCurrent());
      await step("assert-idle", () => {
        if (!this.#finish(change, true)) throw new Error();
      });
    } catch {
      this.#finish(change, false);
      throw new NativeAccountError("recovery-required");
    }
    if (!this.#available)
      await step("storage-check", () => this.initialize()).catch(() => undefined);
  }
  async remove(accountId: string): Promise<void> {
    await this.#requireManagement();
    const change = this.#begin("switch", false, true);
    try {
      await this.#store.readCredentials();
      await this.#store.mutate((next) => {
        if (this.currentAccountId() === accountId)
          throw new NativeAccountError("credential-conflict");
        if (!next.accounts.some((a) => a.accountId === accountId))
          throw new NativeAccountError("unknown-account");
        next.accounts = next.accounts.filter((a) => a.accountId !== accountId);
      });
      await this.#quotas.remove(accountId);
    } finally {
      this.#finish(change, this.#runtime.gate.phase !== "unavailable");
    }
  }
  async startLogin(accountId?: string): Promise<CodexAccountLoginStartResult> {
    await this.#requireManagement();
    if (this.#login) throw new Error("Codex Account sign-in is already in progress");
    if (!this.#startLogin) throw new NativeAccountError("unsupported-storage");
    if (this.#runtime.gate.phase !== "ready")
      throw new OfficialAdmissionError(this.#runtime.gate.phase);
    if (accountId && !this.#store.vault.accounts.some((a) => a.accountId === accountId))
      throw new NativeAccountError("unknown-account");
    const operationId = randomUUID(),
      starting = Promise.withResolvers<undefined>();
    const pending: PendingLogin = {
      operationId,
      accountId: accountId ?? randomUUID(),
      ...(accountId ? { requestedAccountId: accountId } : {}),
      home: path.join(this.#store.directory, "login", operationId),
      cancelled: false,
      saved: false,
      starting: starting.promise,
      finishStart: () => starting.resolve(undefined),
    };
    this.#login = pending;
    try {
      pending.session = await this.#startLogin(pending.home);
      pending.finishStart();
      if (pending.cancelled) {
        await this.#settle(pending, false);
        throw new NativeAccountError("authentication-failed");
      }
      pending.timeout = setTimeout(() => {
        void this.cancelLogin(operationId).catch(() => undefined);
      }, 10 * 60_000);
      pending.timeout.unref();
      void pending.session.completed.then(
        (success) => this.#settle(pending, success),
        () => this.#settle(pending, false),
      );
      return {
        accountId: pending.accountId,
        loginId: operationId,
        verificationUrl: pending.session.verificationUrl,
        userCode: pending.session.userCode,
      };
    } catch {
      pending.finishStart();
      await this.#settle(pending, false);
      throw new NativeAccountError("authentication-failed");
    }
  }
  async cancelLogin(loginId: string): Promise<boolean> {
    const pending = this.#login;
    if (!pending || pending.operationId !== loginId) return false;
    pending.cancelled = true;
    await pending.starting;
    await this.#settle(pending, false);
    return !pending.saved;
  }
  #settle(pending: PendingLogin, success: boolean): Promise<void> {
    return (pending.settling ??= pending.starting.then(() =>
      this.#completeLogin(pending, success),
    ));
  }
  async #completeLogin(pending: PendingLogin, success: boolean): Promise<void> {
    if (pending.timeout) clearTimeout(pending.timeout);
    let completed = false;
    try {
      await pending.session?.close();
      if (success && !pending.cancelled) {
        const credential = await this.#store.readCredentials(pending.home);
        if (!credential) throw new NativeAccountError("authentication-failed");
        const requested = this.#store.vault.accounts.find(
          (a) => a.accountId === pending.requestedAccountId,
        );
        if (
          pending.requestedAccountId &&
          (!requested || !sameCodexCredentialIdentity(requested.identity, credential.identity))
        )
          throw new NativeAccountError("authentication-failed");
        if (pending.cancelled) return;
        pending.accountId = await this.#store.save(credential, pending.accountId);
        pending.saved = true;
        const current = await this.#store.readCredentials();
        if (!current || sameCodexCredentialIdentity(current.identity, credential.identity))
          await this.#changeCredential(pending.accountId, "switch", credential);
        completed = true;
      }
    } catch {
      /* Completion exposes only fixed, nonsecret errors. */
    } finally {
      await rm(pending.home, { recursive: true, force: true }).catch(() => undefined);
      if (this.#login === pending) this.#login = undefined;
      const event: CodexAccountLoginCompleted = {
        accountId: pending.accountId,
        loginId: pending.operationId,
        success: completed,
        saved: pending.saved,
        error: completed
          ? null
          : pending.saved
            ? "Codex Account saved, but it could not be activated"
            : "Codex Account sign-in did not complete",
      };
      for (const listener of this.#listeners) {
        try {
          listener(event);
        } catch {
          /* Listener isolation. */
        }
      }
    }
  }
  subscribeLogin(listener: (event: CodexAccountLoginCompleted) => void): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }
  async inspectInactiveUsage(accountId: string, refresh = false): Promise<CodexAccountUsageResult> {
    await this.refresh();
    const account = this.#store.vault.accounts.find((a) => a.accountId === accountId);
    if (!account || this.currentAccountId() === accountId)
      throw new NativeAccountError("unknown-account");
    return this.#quotas.inspect(account, refresh);
  }
  async recordUsage(
    accountId: string,
    credits: AccountCreditsSnapshot,
  ): Promise<CodexAccountUsageResult> {
    await this.#initializing;
    return this.#quotas.record(accountId, credits);
  }
  cachedUsage(accountId: string): CodexAccountUsageResult | null {
    return this.#quotas.get(accountId);
  }
  async close(): Promise<void> {
    await this.#initializing?.catch(() => undefined);
    if (this.#login) await this.cancelLogin(this.#login.operationId);
    await this.#store.close();
  }
}
