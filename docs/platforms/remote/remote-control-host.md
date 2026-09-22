# Remote Control Harness Host (Experimental)

Use Harnesses that are installed and authenticated only on a controlled Windows machine from another computer, through Codex Desktop's official Remote Control. No SSH and no new network ports; Harness credentials and project files stay on Windows.

## Prerequisites

- The controlled machine runs Windows. macOS is the currently verified controlling side.
- Both computers have the same codexhost version and launch Codex Desktop through codexhost.
- Both sides are signed in with the ChatGPT account Remote Control requires, and official pairing is complete.
- The target Harness is installed and signed in on Windows.

## Connect

1. On Windows, open **Settings → Connections → Control this computer**, enable access, and generate a pairing code.
2. On the controlling side, open **Settings → Connections → Control other devices**, enter the pairing code, and select the Windows environment.
3. Open a project in that environment and pick the target Harness in the composer's Agent / Model selector.

## Troubleshooting

First confirm that native Codex tasks run over Remote Control. Pairing failures, missing environments, and account authorization errors belong to official Remote Control, not codexhost.

- **`unknown variant codexhost/harness/inspect`**: upgrade and restart codexhost on both sides, then reconnect the Remote Control environment.
- **Bridge fails to start, or `no active process for process handle`**: make sure Codex Desktop on Windows was launched through codexhost, restart the controlled side, and reconnect the environment.
- **Initialization times out after Windows restarts**: retry the operation.
- **Native Codex works but no Harnesses appear**: run the connection diagnostics on the controlling side, then check the Harness install and sign-in on Windows.
- **`Claude inbound is disabled`**: Claude Code integration is turned off in codexhost on Windows. Enable it and retry.
