import { idleReleaseSettingsSchema } from "@codexhost/shared-contracts";
import {
  IDLE_RELEASE_CHANGE_EVENT,
  IDLE_RELEASE_STATUS_EVENT,
  IDLE_RELEASE_STORAGE_KEY,
  readIdleReleasePreference,
  writeIdleReleasePreference,
  type IdleReleaseSyncStatus,
} from "../renderer-idle-release-preference.js";
import type { RendererSettingsMessages } from "./localization.js";

export function mountIdleReleaseControls(
  content: HTMLElement,
  messages: RendererSettingsMessages,
): () => void {
  const document = content.ownerDocument;
  const owner = document.defaultView;
  if (!owner) return () => undefined;
  const heading = document.createElement("div");
  heading.className = "settings-section-label";
  heading.textContent = messages.idleReleaseSection;
  const toggleRow = document.createElement("label");
  toggleRow.className = "settings-preference-row";
  const copy = document.createElement("span");
  copy.className = "settings-preference-row__copy";
  const title = document.createElement("strong");
  title.textContent = messages.idleReleaseTitle;
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.className = "settings-preference-checkbox";
  checkbox.setAttribute("aria-label", messages.idleReleaseTitle);
  copy.append(title);
  toggleRow.append(copy, checkbox);
  const timeoutRow = document.createElement("label");
  timeoutRow.className = "settings-preference-row";
  const timeoutTitle = document.createElement("span");
  timeoutTitle.textContent = messages.idleReleaseTimeout;
  const minutes = document.createElement("input");
  minutes.type = "number";
  minutes.className = "settings-preference-number";
  minutes.min = "10";
  minutes.max = "1440";
  minutes.step = "1";
  minutes.setAttribute("aria-label", messages.idleReleaseTimeout);
  timeoutRow.append(timeoutTitle, minutes);
  const help = document.createElement("p");
  help.className = "settings-page-description";
  help.textContent = messages.idleReleaseRange;
  const warning = document.createElement("p");
  warning.className = "settings-page-description";
  const status = document.createElement("p");
  status.className = "settings-page-description";
  status.setAttribute("role", "status");
  const showStatus = (value: IdleReleaseSyncStatus): void => {
    status.textContent =
      value === "applied"
        ? messages.idleReleaseApplied
        : value === "unavailable"
          ? messages.idleReleaseUnavailable
          : value === "failed"
            ? messages.idleReleaseFailed
            : messages.idleReleasePending;
  };
  const sync = (): void => {
    const settings = readIdleReleasePreference(owner);
    checkbox.checked = settings.enabled;
    minutes.value = String(settings.timeoutMinutes);
    warning.textContent = messages.idleReleaseWarning.replace("{minutes}", minutes.value);
  };
  const save = (): void => {
    const parsed = idleReleaseSettingsSchema.safeParse({
      enabled: checkbox.checked,
      timeoutMinutes: minutes.valueAsNumber,
    });
    minutes.setCustomValidity(parsed.success ? "" : messages.idleReleaseInvalid);
    minutes.setAttribute("aria-invalid", String(!parsed.success));
    if (!parsed.success) {
      status.textContent = messages.idleReleaseInvalid;
      checkbox.checked = readIdleReleasePreference(owner).enabled;
      return;
    }
    const notice = messages.idleReleaseWarning.replace(
      "{minutes}",
      String(parsed.data.timeoutMinutes),
    );
    if (
      parsed.data.enabled &&
      !readIdleReleasePreference(owner).enabled &&
      !owner.confirm(notice)
    ) {
      sync();
      return;
    }
    if (!writeIdleReleasePreference(owner, parsed.data)) {
      sync();
      showStatus("failed");
    }
  };
  const storage = (event: StorageEvent): void => {
    if (event.key === IDLE_RELEASE_STORAGE_KEY || event.key === null) sync();
  };
  const onStatus = (event: Event): void =>
    showStatus((event as CustomEvent<IdleReleaseSyncStatus>).detail);
  checkbox.addEventListener("change", save);
  minutes.addEventListener("change", save);
  minutes.addEventListener("input", () => {
    minutes.setCustomValidity("");
    minutes.removeAttribute("aria-invalid");
  });
  owner.addEventListener(IDLE_RELEASE_CHANGE_EVENT, sync);
  owner.addEventListener(IDLE_RELEASE_STATUS_EVENT, onStatus);
  owner.addEventListener("storage", storage);
  content.append(heading, toggleRow, timeoutRow, help, warning, status);
  sync();
  showStatus("pending");
  // Ask the installed connection synchronizer to report whether the saved setting was applied.
  owner.dispatchEvent(new Event(IDLE_RELEASE_CHANGE_EVENT));
  return () => {
    owner.removeEventListener(IDLE_RELEASE_CHANGE_EVENT, sync);
    owner.removeEventListener(IDLE_RELEASE_STATUS_EVENT, onStatus);
    owner.removeEventListener("storage", storage);
  };
}
