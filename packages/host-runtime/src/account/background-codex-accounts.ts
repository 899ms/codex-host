import type { JsonValue } from "@codexhost/protocol-core";
import type {
  AccountCreditsSnapshot,
  CodexAccountLoginCompleted,
} from "@codexhost/shared-contracts";
import type { CodexAccountControl } from "./codex-account-control.js";

/** Stable control while collection opens after native startup. Native traffic never awaits it. */
export class BackgroundCodexAccounts implements CodexAccountControl {
  readonly #ready: Promise<CodexAccountControl>;
  #control: CodexAccountControl;

  constructor(fallback: CodexAccountControl, initialize: () => Promise<CodexAccountControl>) {
    this.#control = fallback;
    this.#ready = initialize().then(
      (control) => (this.#control = control),
      () => fallback,
    );
  }
  snapshot() {
    return this.#control.snapshot();
  }
  currentAccountId() {
    return this.#control.currentAccountId();
  }
  async refresh() {
    const control = await this.#ready;
    return control.refresh ? control.refresh() : control.snapshot();
  }
  async switch(accountId: string) {
    return (await this.#ready).switch(accountId);
  }
  async remove(accountId: string) {
    return (await this.#ready).remove(accountId);
  }
  async startLogin(accountId?: string) {
    return (await this.#ready).startLogin(accountId);
  }
  async cancelLogin(loginId: string) {
    return (await this.#ready).cancelLogin(loginId);
  }
  async logout() {
    return (await this.#ready).logout();
  }
  async recover() {
    return (await this.#ready).recover();
  }
  observe(value: JsonValue) {
    this.#control.observe(value);
  }
  subscribeLogin(listener: (value: CodexAccountLoginCompleted) => void): () => void {
    let closed = false;
    let unsubscribe: (() => void) | undefined;
    void this.#ready.then((control) => {
      if (!closed) unsubscribe = control.subscribeLogin(listener);
    });
    return () => {
      closed = true;
      unsubscribe?.();
    };
  }
  async inspectInactiveUsage(accountId: string, refresh = false) {
    const control = await this.#ready;
    if (!control.inspectInactiveUsage) throw new Error("Codex Account management is unavailable");
    return control.inspectInactiveUsage(accountId, refresh);
  }
  async recordUsage(accountId: string, credits: AccountCreditsSnapshot) {
    const control = await this.#ready;
    if (!control.recordUsage) throw new Error("Codex Account management is unavailable");
    return control.recordUsage(accountId, credits);
  }
  cachedUsage(accountId: string) {
    return this.#control.cachedUsage?.(accountId) ?? null;
  }
  async settled(): Promise<void> {
    await this.#ready;
  }
}
