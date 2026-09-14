import { describe, expect, it } from "vitest";

import {
  codexAccountListResultSchema,
  codexAccountLoginCompletedSchema,
  codexAccountUsageResultSchema,
} from "../src/index.js";

const baseSnapshot = {
  version: 2 as const,
  currentAccountId: "account-a",
  phase: "ready" as const,
  revision: 7,
  capabilities: { manage: true, switch: true, login: true, delete: true },
  accounts: [{ accountId: "account-a", label: "Account A", email: "a@example.com" }],
};

describe("Codex Account browser contracts", () => {
  it("keeps the PR252 v2 snapshot compatible and excludes credential locations", () => {
    expect(codexAccountListResultSchema.parse(baseSnapshot)).toEqual(baseSnapshot);
    expect(() =>
      codexAccountListResultSchema.parse({
        ...baseSnapshot,
        accounts: [{ ...baseSnapshot.accounts[0], codexHome: "/private/home" }],
      }),
    ).toThrow();
  });

  it("accepts Host epoch and recovery operation", () => {
    const snapshot = {
      ...baseSnapshot,
      phase: "unavailable" as const,
      instanceId: "host-epoch-2",
      pendingOperation: { operationId: "recover-1", kind: "recovery" as const },
      capabilities: {
        ...baseSnapshot.capabilities,
        recover: true,
        logout: false,
        reason: "recovery-required" as const,
      },
    };
    expect(codexAccountListResultSchema.parse(snapshot)).toEqual(snapshot);
    for (const reason of ["keyring-unavailable", "migration-required"]) {
      expect(
        codexAccountListResultSchema.safeParse({
          ...snapshot,
          capabilities: { ...snapshot.capabilities, reason },
        }).success,
      ).toBe(false);
    }
    for (const field of ["cleanupRequired", "legacyHistoryPreserved"]) {
      expect(codexAccountListResultSchema.safeParse({ ...snapshot, [field]: true }).success).toBe(
        false,
      );
    }
  });

  it("separates a saved login from activation success", () => {
    expect(
      codexAccountLoginCompletedSchema.parse({
        accountId: "account-b",
        loginId: "login-1",
        success: false,
        error: "Codex Account saved, but it could not be activated",
        saved: true,
      }),
    ).toMatchObject({ saved: true, success: false });
  });

  it("tracks a pending Settings login without changing phase", () => {
    const snapshot = {
      ...baseSnapshot,
      pendingOperation: { kind: "login", operationId: "login-1" },
    };
    expect(codexAccountListResultSchema.parse(snapshot)).toEqual(snapshot);
  });

  it("rejects retired login cleanup state", () => {
    expect(
      codexAccountLoginCompletedSchema.safeParse({
        accountId: "account-b",
        loginId: "login-1",
        success: false,
        saved: true,
        error: "Activation failed",
        cleanupRequired: true,
      }).success,
    ).toBe(false);
  });

  it("requires quota freshness and observation time", () => {
    expect(
      codexAccountUsageResultSchema.parse({
        accountId: "account-a",
        usage: null,
        freshness: "cached",
        observedAt: "2026-09-11T00:00:00.000Z",
      }),
    ).toMatchObject({ freshness: "cached" });
  });
});
