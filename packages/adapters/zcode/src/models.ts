import {
  harnessIdSchema,
  harnessModelCatalogSchema,
  harnessModelRefSchema,
  harnessPermissionModeCatalogSchema,
  harnessPermissionModeIdSchema,
  harnessThinkingOptionIdSchema,
  nativeSessionRefSchema,
  type HarnessModelRef,
} from "@codexhost/shared-contracts";
import {
  parseHostUsage,
  type HarnessSessionState,
  type HostUsage,
} from "@codexhost/harness-adapter";
import {
  nativeModelSchema,
  type NativeModel,
  type NativeSettings,
  type NativeSnapshot,
} from "./protocol.js";
import { ZcodeError } from "./errors.js";

export const ZCODE_ID = harnessIdSchema.parse("zcode");
export function encodeModel(model: NativeModel): HarnessModelRef {
  return harnessModelRefSchema.parse({
    id: `zcode-v1.${Buffer.from(JSON.stringify([model.providerId, model.modelId])).toString("base64url")}`,
  });
}
export function decodeModel(model: HarnessModelRef): NativeModel {
  try {
    const value: unknown = JSON.parse(
      Buffer.from(model.id.slice("zcode-v1.".length), "base64url").toString("utf8"),
    );
    if (!model.id.startsWith("zcode-v1.") || !Array.isArray(value) || value.length !== 2)
      throw new Error();
    const native = nativeModelSchema.parse({ providerId: value[0], modelId: value[1] });
    if (encodeModel(native).id !== model.id) throw new Error();
    return native;
  } catch {
    throw new ZcodeError("invalidRequest", "Invalid ZCode model reference");
  }
}
export function modelCatalog(settings: NativeSettings) {
  const available = settings.model.available.filter((model) => !model.disabledReason);
  const levels = new Map(settings.thoughtLevel.available.map((level) => [level.value, level]));
  for (const model of available)
    for (const level of model.reasoning?.levels ?? []) levels.set(level.value, level);
  const current = encodeModel(settings.model.current);
  const defaultThinking = settings.thoughtLevel.current ?? settings.thoughtLevel.defaultLevel;
  return harnessModelCatalogSchema.parse({
    models: available.map((model) => ({
      ref: encodeModel(model.ref),
      label: model.label,
      supportedThinkingOptionIds: model.reasoning?.enabled
        ? model.reasoning.levels.map((level) => level.value)
        : [],
    })),
    ...(available.some((model) => encodeModel(model.ref).id === current.id)
      ? { defaultModel: current }
      : {}),
    thinkingOptions: [...levels.values()].map((level) => ({ id: level.value, label: level.label })),
    ...(defaultThinking && levels.has(defaultThinking)
      ? { defaultThinkingOptionId: defaultThinking }
      : {}),
  });
}
const modeLabels = {
  build: "Confirm changes",
  edit: "Auto edit",
  plan: "Plan",
  yolo: "Full access",
  auto: "Auto",
};
export function permissionModes(current: NativeSettings["mode"]["current"] = "build") {
  return harnessPermissionModeCatalogSchema.parse({
    modes: Object.entries(modeLabels).map(([id, label]) => ({
      id,
      label,
      ...(id === "yolo" ? { dangerous: true } : {}),
    })),
    defaultModeId: current,
  });
}
export function sessionState(snapshot: NativeSnapshot): HarnessSessionState {
  const settings = snapshot.settings;
  const model = settings.model.available.find(
    (candidate) => encodeModel(candidate.ref).id === encodeModel(settings.model.current).id,
  );
  return {
    nativeRef: nativeSessionRefSchema.parse({
      harnessId: ZCODE_ID,
      nativeSessionId: snapshot.session.sessionId,
      formatVersion: 1,
      locator: { cwd: snapshot.session.workspace.workspacePath },
    }),
    ...(settings.model.current.providerId !== "zcode-unconfigured"
      ? { effectiveModel: encodeModel(settings.model.current) }
      : {}),
    ...(model ? { resolvedModelLabel: model.label } : {}),
    ...(settings.thoughtLevel.enabled && settings.thoughtLevel.current
      ? {
          effectiveThinkingOptionId: harnessThinkingOptionIdSchema.parse(
            settings.thoughtLevel.current,
          ),
        }
      : {}),
    availableThinkingOptions: settings.thoughtLevel.available.map((level) => ({
      id: harnessThinkingOptionIdSchema.parse(level.value),
      label: level.label,
    })),
    effectivePermissionModeId: harnessPermissionModeIdSchema.parse(settings.mode.current),
  };
}
export function contextUsage(snapshot: NativeSnapshot): HostUsage | null {
  return snapshot.projection.contextWindow > 0
    ? parseHostUsage({
        contextUsedTokens: snapshot.projection.contextUsed,
        contextWindowTokens: snapshot.projection.contextWindow,
      })
    : null;
}
