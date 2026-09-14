import type {
  AccountCreditsSnapshot,
  CodexAccountListResult,
  CodexAccountLoginCompleted,
  CodexAccountLoginStartResult,
  CodexAccountUsageResult,
} from "@codexhost/shared-contracts";

/** Global Codex Account control plane. Credentials never cross this boundary. */
export interface CodexAccountControl {
  snapshot(): CodexAccountListResult;
  /** Refresh native-derived selection and collect credentials without changing native auth. */
  refresh?(): Promise<CodexAccountListResult>;
  currentAccountId(): string | null;
  switch(accountId: string): Promise<void>;
  remove(accountId: string): Promise<void>;
  startLogin(accountId?: string): Promise<CodexAccountLoginStartResult>;
  cancelLogin(loginId: string): Promise<boolean>;
  logout(): Promise<void>;
  recover(): Promise<void>;
  subscribeLogin(listener: (value: CodexAccountLoginCompleted) => void): () => void;
  inspectInactiveUsage?(
    accountId: string,
    forceRefresh?: boolean,
  ): Promise<CodexAccountUsageResult>;
  recordUsage?(
    accountId: string,
    accountCredits: AccountCreditsSnapshot,
  ): Promise<CodexAccountUsageResult>;
  cachedUsage?(accountId: string): CodexAccountUsageResult | null;
}

function unavailable(): Promise<never> {
  return Promise.reject(
    Object.assign(new Error("Codex Account management is unavailable"), {
      code: "unavailable",
    }),
  );
}

/** Read-only projection used when native Codex owns authentication itself. */
export class SingleNativeCodexAccount implements CodexAccountControl {
  constructor(private readonly summary: () => CodexAccountListResult) {}

  snapshot(): CodexAccountListResult {
    return this.summary();
  }
  currentAccountId(): string | null {
    return this.summary().currentAccountId;
  }
  switch(): Promise<void> {
    return unavailable();
  }
  remove(): Promise<void> {
    return unavailable();
  }
  startLogin(): Promise<CodexAccountLoginStartResult> {
    return unavailable();
  }
  cancelLogin(): Promise<boolean> {
    return unavailable();
  }
  logout(): Promise<void> {
    return unavailable();
  }
  recover(): Promise<void> {
    return unavailable();
  }
  subscribeLogin(): () => void {
    return () => undefined;
  }
}
