# @veren/startup-autostart-recovery

Recovers the work an unclean DeepSeek Harness shutdown interrupted. Use this plugin when a crash, a killed process, or a power cut should be picked up at the next start; skip it when restarts are always graceful or recovery prompts are not wanted.

## What it does

1. **Unclean-exit detection.** A boot flag file in the state directory (default `$DSH_HOME/storages/startup-recovery/boot-flag.json`) is claimed at every boot and removed only by a graceful shutdown. "Flag still present at boot" therefore means the previous process died before its cleanup — including killed processes and power cuts, which never reach cleanup code. A first boot finds no flag and is treated as clean.
2. **Honest cause lookup.** The cause comes from the desktop crash-log directory (`%APPDATA%\@deepseek-ai\dsh-desktop\logs`, newest `crash-*.log` newer than the previous boot's start). When no log proves a cause, the prompt says `原因未知（未找到崩溃日志）` verbatim — the plugin never invents a reason.
3. **Recovery prompt.** On detecting an unclean exit, the plugin delivers `DSH 系统由于 <真实原因> 退出后重启，请继续未完成的工作。` to the last active session it recorded (via the `agent/created` event, persisted to `last-session.json`). Delivery happens **directly during this boot**, not through a startup item — creating or updating a startup item never fires it in the current run. The flag is claimed before delivery, so one crash recovers at most once.
4. **Windows logon autostart (off by default).** Writes one `.cmd` file into the per-user Startup folder (`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\DeepSeek Harness (startup-autostart-recovery).cmd`). Chosen over the `Run` registry key and scheduled tasks because it needs no administrator rights, is one plain file, and verifies by mere existence. Enable (`startupRecovery.enableAutostart()`), status (`autostart()`), and undo (`disableAutostart()`) are explicit service calls; the plugin never writes the entry by itself. Enabling requires `config.autostartCommand` to name the command line that starts DeepSeek Harness and fails loud otherwise.

## Configuration

| Field | Meaning |
| --- | --- |
| `stateDir` | Override for the boot flag / last-session directory. |
| `crashLogDir` | Override for the desktop crash-log directory. |
| `autostartFolder` | Override for the Startup folder. |
| `autostartCommand` | Command line that starts DeepSeek Harness (required only to enable autostart). |
| `recoveryEnabled` | Master switch for the recovery prompt itself (default on). |

## Known limits

- The last active session is whatever `agent/created` reported last, including subagent sessions; the plugin cannot enumerate sessions any other way without host changes.
- A delivery that fails is logged and not retried in this boot (at-most-once semantics).

## Development

```sh
pnpm --dir plugins/startup-autostart-recovery test        # vitest
pnpm --dir plugins/startup-autostart-recovery typecheck   # against the Harness sources
pnpm --dir plugins/startup-autostart-recovery build       # emit dist/
```
