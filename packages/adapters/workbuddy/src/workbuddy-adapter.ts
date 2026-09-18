import {
  CodeBuddyAcpClient,
  CodeBuddyAdapter,
  type CodeBuddyAdapterOptions,
} from "@codexhost/adapter-codebuddy";
import type { HarnessResult, HarnessSession, OpenSessionInput } from "@codexhost/harness-adapter";
import { workBuddyInvocation } from "./command.js";
import { WORKBUDDY_RUNTIME_PROFILE } from "./common.js";

export type WorkBuddyAdapterOptions = Omit<
  CodeBuddyAdapterOptions,
  "profile" | "invocationFactory"
>;

export class WorkBuddyAdapter extends CodeBuddyAdapter {
  constructor(options: WorkBuddyAdapterOptions = {}) {
    super({
      ...options,
      profile: WORKBUDDY_RUNTIME_PROFILE,
      invocationFactory: workBuddyInvocation,
      clientFactory:
        options.clientFactory ??
        ((clientOptions) => new CodeBuddyAcpClient(clientOptions, undefined, workBuddyInvocation)),
    });
  }

  override async open(input: OpenSessionInput): Promise<HarnessResult<HarnessSession>> {
    if (
      input.kind === "create" &&
      input.executionPolicy === "unattended-full-access" &&
      input.permissionModeId &&
      input.permissionModeId !== "fullAccess"
    ) {
      return {
        ok: false,
        error: {
          code: "invalidRequest",
          message: "WorkBuddy: unattended execution requires native fullAccess permissions",
          retryable: false,
        },
      };
    }
    return super.open(input);
  }
}
