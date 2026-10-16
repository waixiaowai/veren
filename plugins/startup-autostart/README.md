# Startup Autostart

Runs the work you registered every time DeepSeek Harness finishes starting:
create a session, resume one, wake one with a message, or leave a quiet message
in its inbox. Every enabled item runs on every successful start, with no
debounce — a restart interrupts the work the previous start began.

## What it is

This package supplies only the Host service: durable items, the startup trigger, and the Typert Remote surface (`ctx.remote.startup`). Install the optional `@veren/startup-autostart-tool` package separately when agents need the `startup_*` tools. Its loader row can be mounted selectively without changing the Host service.

## When to use it

Use it for work that must happen *at every start*: warm a session up, hand a
standing instruction to a session you already have, or leave a message that the
session reads the next time it runs.

Use `@deepseek-ai/dsh-schedule` instead when the work is time-based — "at 09:00",
"every 30 minutes" — rather than start-based. The two features share no storage
and no tool names.

## Actions

| Action | What it does |
| --- | --- |
| `new_session` | Creates a session at `cwd` or in `workspace_id`, and delivers `message` as its first turn when one is given |
| `resume_session` | Brings an existing `session_id` live; carries no message |
| `message_session` | Resumes `session_id` and delivers `message` as a new turn, waking it |
| `queue_message` | Resumes `session_id` and leaves `message` in its inbox **without** waking it |

## Storage

Items live in the `startup` domain of the profile's default storage backend, so
the file is `$DSH_HOME/storages/startup.json`. It is independent of session logs
and of any workspace folder: deleting a project directory never deletes an item.

The row the management panel reads is `tables.items`, one object per item keyed
by its `startup-<uuid>` id, with `enabled`, the last run instant, and the last
outcome.

## Trigger

Two paths, because the launcher's successful-start signal is optional:

1. `ctx.get('appReady').onReady(...)` when the launcher provides it — committed
   after the whole plugin tree mounted and the surface is serving. A late
   subscription fires immediately, so an HMR reload re-arms the trigger.
2. Plugin activation completion, when no launcher signal exists at all.

Both funnel into one latched drive per activated service, and every delivery runs
inside `ctx.agents.withoutInitiator`. Those two facts are the whole guard: the
latch makes one drive per activation, and the initiator-free scope keeps a
Session this plugin wakes from re-entering the trigger. A failure to open the
storage domain, or the absence of `appReady`, degrades to a logged, inert
feature; it never fails the Harness boot that mounted it.

## Profile coverage

The service injects only services every profile mounts: `agents`, `sessions`,
and `storageDomain`. Sessions are driven through the core `ctx.agents` registry
(`agents.create` / `agents.resume`), the same calls the headless runner makes.

The Web application's `sessionController` is read through `ctx.get` when it is
present, because only it resolves `preset` and `workspaceId` targets and
installs a model selection on a live Agent. It is absent from the headless, ACP,
and SDK bundles — which is why it is not an injection: a hard dependency on it
left this plugin permanently pending in those profiles. An item that targets a
preset or a workspace in such a profile records a failed run naming that reason
instead of quietly creating a plainer Session than the item asked for.

## Every start runs the item

There is no debounce. Every successful start runs every enabled item, and
`startup_run` is not debounced either — its only gate is `enabled`, which
`force` overrides. A restart interrupts the sessions the items drive, so a run
suppressed by a cooldown is work the user never gets back.

The run history (`lastRunAt`, `lastOutcome`, `runCount`) is retained as a record
of what happened; it gates nothing. `startup.json` rows written by version 1.1.0
still carry a `cooldownSeconds` key: the record schema is open, so the key is
stripped on read and gone after the next write, and the domain stays at version 1
because a `single`-layout backend reads only an exactly matching stored version.

The guard against a double dispatch is the latch plus the initiator-free scope:
one drive per activated service, every delivery inside
`ctx.agents.withoutInitiator`, so a Session the plugin wakes cannot re-enter the
trigger. A re-activation of the plugin row — an HMR reload, a reinstall, a loader
tree write-back — is a new activated service, so it drives again by design.

## Build and check

```sh
node scripts/gen-tsconfig-paths.mjs   # refresh tsconfig.paths.json from the checkout
node scripts/typecheck.mjs            # type-check sources and specs against the real Harness sources
node scripts/build.mjs                # emit dist/*.js
node node_modules/vitest/vitest.mjs run
```

The plugin is plain ESM JavaScript at runtime; TypeScript is the authoring
language for both the sources under `src/` and the specs under `tests/`, checked
against the Harness checkout's own sources through `tsconfig.paths.json`.

`vitest.config.ts` lowers the plugin's standard decorators before the bundler's
own transform: the bundler leaves them in place at its default target, and Node
then rejects the literal `@`. The config runs the same `transpileModule` options
the build uses, so the specs see exactly what `dist/` contains.

`scripts/dump-session.cjs` prints a session log's events; session logs are zstd
with one frame per durable append, which a whole-file decompressor stops reading
after the first frame.

## Install

```
plugin_manager  install_bundle  target = @veren/startup-autostart@1.2.0
```

The Chinese delivery note for the person operating this plugin lives in
[`交付说明.md`](交付说明.md).
