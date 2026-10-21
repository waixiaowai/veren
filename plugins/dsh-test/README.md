---
title: dsh-test — managed DSH web instance for plugin testing
description: TypeScript Host plugin that launches and restarts a dsh profile web instance and exposes its token URL through the get_dsh_test_info tool.
---

# dsh-test

A Host-only test utility plugin written in TypeScript (`src/`) and compiled to plain ESM JavaScript (`dist/`, what the DSH Loader loads). On activation it frees the target port when one is known, spawns the dsh CLI web runner (`pnpm dsh web --no-open` by default), waits for the CLI's ready line `dsh web: <url>`, and records that token-bearing URL.

Two tools share one managed instance:

| Tool | When to use |
| --- | --- |
| `get_dsh_test_info` | Read the current state. Read-only; never starts, stops, or repairs anything. |
| `restart_dsh_test` | Recycle the instance: stop its process tree, free the port again, and wait for a new WEB_URL. |

## Layout

```
src/index.ts    plugin entry: Config (Standard Schema), apply(), lifecycle wiring
src/types.ts    type-only definitions (config, tool, context subset) — erased at build
src/tools.ts    model-facing tool definitions shared by both tools
src/port.ts     target-port pre-check, listener lookup, and listener termination
src/process.ts  bounded command capture, child-environment scrub, and process-tree termination
dist/           tsc output loaded by DSH (built, not hand-edited)
```

Build: `pnpm install && pnpm build` (or any TypeScript >= 5.9: `tsc -p tsconfig.json`).

## Tools

### get_dsh_test_info

| Field | Meaning |
| --- | --- |
| `WEB_URL` | Token-bearing access URL; present once the instance is ready. |
| `DSH_HOME` | Harness home directory (`dshHome` config, `$DSH_HOME`, or `~/.dsh`). |
| `DSH_SRC` | Source directory (`srcDir` config, or the sibling deepseek-harness checkout). |
| `PORT` | Target port known to the pre-check; absent when the CLI picked the port itself. |
| `STATUS` | `starting`, `ready`, or `error`. |
| `ERROR` | Readable startup or restart failure reason; present only after a failure. |

### restart_dsh_test

Stops the current process tree, waits for the target port to be released, checks the port again, and launches a fresh instance. The result uses the same fields as `get_dsh_test_info`, so a successful restart returns the new `WEB_URL` and a failed restart returns `STATUS=error` plus a readable `ERROR` instead of throwing. Concurrent or back-to-back calls are serialized, so a second call restarts the instance created by the first one.

## Port pre-check

Before every launch (initial activation and restart), the plugin determines the target port:

1. `port` in the plugin config wins.
2. Otherwise, a `--port N` or `--port=N` argument in `args` is used.
3. Otherwise the CLI chooses the port, **no occupancy check or cleanup runs**, and the tool output has no `PORT` field.

When a target port is known, the plugin finds the process listening on it, stops only that listener (Windows `taskkill /T`, POSIX SIGTERM then SIGKILL), and waits until the socket is released. An unrelated dsh instance is not touched. If the listener cannot be identified (for example `lsof`/`ss` are unavailable), the launch fails with a readable `ERROR` instead of killing an arbitrary process.

## Configuration

| Field | Default |
| --- | --- |
| `command` | `pnpm` |
| `args` | `['dsh', 'web', '--no-open']` |
| `port` | CLI default; `args` may carry `--port` instead |
| `cwd` | `srcDir` |
| `srcDir` | The deepseek-harness checkout beside this plugin |
| `dshHome` | `$DSH_HOME`, then `~/.dsh` |
| `startupTimeoutMs` | `180000` |

The managed child gets a scrubbed environment matching the official subprocess service: credential-shaped names (`*KEY*`, `*PASSWORD*`, `*SECRET*`, `*TOKEN*`) and all `DSH_*` names are removed, then `DSH_HOME` is set explicitly. Put credentials in the target home's credentials store, not in ambient environment variables.

The bundled `cordis.patch.yml` sets this deployment's `srcDir`, isolated test-node `dshHome`, and `port: 3210`.

## Install

Install the bundle at this directory (package name `@local/dsh-test`) through the DeepSeek Harness plugin manager. The production web runner needs built artifacts (`pnpm run build`) in the target checkout; a missing build surfaces as a readable `ERROR` in the tool output.
