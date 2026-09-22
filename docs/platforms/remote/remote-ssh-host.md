# Remote SSH Harness Host

Use Harnesses that are installed and authenticated only on a controlled machine (including Claude Code) from your local Codex Desktop, through its native SSH workspace. Credentials stay on the controlled machine and are never forwarded over SSH.

## Prerequisites

- Local machine: Codex Desktop and codexhost installed. macOS, Linux, or Windows.
- Controlled machine: macOS or x64/ARM64 Linux (Windows is not supported yet), with Codex CLI and **the same codexhost version** as the local machine.
- The target Harness is installed and signed in on the controlled machine.
- The native Codex Desktop SSH workspace already works (**Settings → Connections → SSH**).

## Install

On the controlled machine:

```bash
npm install -g @codexhost/cli
codexhost remote install
codexhost remote start
codexhost remote status
```

`remote install` only adds a marked block to the Shell profile for SSH sessions (backing up the profile first). Local Shells and your existing `codex` command are not affected. On macOS it also installs a per-user LaunchAgent that starts Claude Code in the logged-in session; it does not read the Keychain or any credentials.

## Usage

1. Launch Codex Desktop through codexhost on the local machine.
2. Open the SSH workspace.
3. Pick the target Harness in the composer's Agent / Model selector.

## Commands

```bash
codexhost remote status     # Show running state and install integrity
codexhost remote start      # Start (safe to run repeatedly)
codexhost remote stop       # Stop without affecting other Codex processes
codexhost remote uninstall  # Uninstall, keeping Thread mapping data
```

After starting, stopping, or uninstalling, reconnect the SSH workspace in Desktop.

## Upgrade

Upgrade both machines to the same version with the same package manager. Then run `codexhost remote install` and `codexhost remote start` again on the controlled machine, and reconnect the SSH workspace.

## Troubleshooting

- **`codexhost/harness/inspect is unsupported on this Host connection`**: the SSH connection is not going through codexhost. Make sure the same codexhost version is installed and started on the controlled machine, then reconnect the SSH workspace.
- **`remote status` reports degraded or asks for a reinstall**: run `codexhost remote install`, then `codexhost remote start`.
- **A Harness is missing**: check that it is installed and signed in on the controlled machine, then click "Run connection diagnostics" in Settings.
- **Install fails on macOS with a launchd / `gui/$UID` error**: the controlled machine needs a logged-in graphical session. Log in, then run `codexhost remote install` again.
