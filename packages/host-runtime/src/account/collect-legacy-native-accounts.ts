import { inspectNativeAccountLayout } from "./native-account-layout.js";
import { importLegacyAccountCredentials } from "./legacy-account-credentials.js";
import type { NativeAccountStore } from "./native-account-store.js";
import { NativeAccountError } from "./native-profile-vault.js";

/** Optional collection after native startup. Never selects a home, stops Codex or writes auth. */
export async function collectLegacyNativeAccounts(
  store: NativeAccountStore,
  data: string,
): Promise<void> {
  const layout = await inspectNativeAccountLayout(data, store.home);
  if (
    layout.kind !== "migration-required" ||
    !layout.credentialImport ||
    store.vault.legacyRegistryDigest
  )
    return;
  const { registryDigest } = layout.credentialImport;
  await importLegacyAccountCredentials({
    store,
    registryDigest,
    homes: layout.homes.map((entry) => entry.home),
    assertAdmission: async () => {
      store.assertOwnership();
      const latest = await inspectNativeAccountLayout(data, store.home);
      if (
        latest.kind !== "migration-required" ||
        latest.credentialImport?.registryDigest !== registryDigest ||
        JSON.stringify(latest.homes.map((entry) => entry.home)) !==
          JSON.stringify(layout.homes.map((entry) => entry.home))
      )
        throw new NativeAccountError("credential-conflict");
    },
    readCredentials: (home) => store.readCredentials(home),
  });
}
