# @veren/commander-tests

[中文文档](./README.cn.md)

The veren CLI's `tests` command group for isolated DSH training grounds. A training ground is one independent `DSH_HOME` under the repository's `deepseek/.dsh` directory, with keys and model configuration copied from the global `~/.dsh`, so plugin development never writes to the machine-wide harness home.

## When to use

- You develop a DSH plugin and need a disposable harness home per plugin.
- You want the same model providers and API keys as your global setup without sharing its profile, sessions or pnpm store.
- You want an auditable list of test nodes and an explicit, opt-in cleanup step.

Skip it when you already manage `DSH_HOME` directories with your own scripts.

## Commands

```bash
pnpm cli tests create demo
pnpm cli tests list
pnpm cli tests show demo
pnpm cli tests path demo
pnpm cli tests start demo --port 3080 --no-open
pnpm cli tests remove demo --yes
```

When the packaged `veren` binary is on `PATH`, the same commands work as `veren tests ...`.

| Subcommand | Behaviour |
| --- | --- |
| `create <name>` | Creates `<root>/<name>`, copies credentials and model configuration, writes an isolated profile `.npmrc`, initializes the profile through `dsh plugin --profile web version-exemptions`, then writes `.veren-tests.json`. |
| `list` | Prints every directory under the root as JSON, including unmanaged ones (`managed: false`). |
| `show <name>` | Prints one training-ground summary as JSON. |
| `path <name>` | Prints only the absolute `DSH_HOME`, suitable for `cd "$(pnpm cli tests path demo)"`. |
| `remove <name> --yes` | Removes a managed training ground. Without `--yes` it refuses. Unmanaged directories additionally need `--force`. |
| `start <name>` | Runs `dsh web` with `DSH_HOME=<training ground>` and inherited stdio. |

## What `create` copies

From the source DSH home (`--from`, default `~/.dsh`):

- `.credentials.yaml` — required; creation fails when it is missing.
- `.env` and `settings.yaml` — copied when present.
- Model entries from `profiles/<source>/cordis.patch.yml`: entries whose `id` starts with `llm-`, plus `agent-default-model`. The source profile is the explicit `--from-profile`, otherwise the target profile, then `desktop`, then `web` (the first profile that contains model entries).
- `profiles/<source>/.npmrc` registry and authentication lines, while `store-dir` and `package-import-method` are replaced with an isolated store and `copy` installs.

The target profile keeps its other patch entries; same-id model entries are replaced. The source home is never written.

## Safety

- The training-ground root must not overlap the source `DSH_HOME`; the command rejects such configurations before writing.
- Names are one path segment (letters, digits, dot, underscore, hyphen; 1–64 characters) and Windows reserved device names are rejected.
- `remove` requires explicit `--yes`; a directory without `.veren-tests.json` needs `--force` as well.
- The active `DSH_HOME` is never removable, even with `--force`.
- A failed `create` removes only the directory it created.

## Configuration

The plugin config is defined with `@deepseek-ai/schemastery`; all fields default to blank and are resolved as follows.

| Field | Default |
| --- | --- |
| `root` | `<repo>/deepseek/.dsh`, overridable with `VEREN_TESTS_ROOT` |
| `sourceHome` | `~/.dsh`, overridable with `VEREN_TESTS_SOURCE_HOME` |
| `harnessRoot` | `<repo>/deepseek/deepseek-harness`, overridable with `VEREN_DSH_HARNESS` |
| `profile` | `web` |

Every subcommand also accepts `--root <dir>`; `create` adds `--from <home>`, `--profile <name>` and `--from-profile <name>`.

## Development

```bash
pnpm --filter @veren/commander-tests build
pnpm --filter @veren/commander-tests test
```

```text
packages/commander/tests
├── src/
│   ├── ground.ts         # create/list/show/remove + path safety
│   ├── model-config.ts   # model-entry extraction and patch merge
│   ├── dsh.ts            # dsh subprocess + cleaned environment
│   ├── commands.ts       # subcommand parsing and JSON output
│   └── index.ts          # plugin module: name/inject/Config/apply
└── test/index.test.ts
```

## Notes and constraints

- `create` initializes the profile through the DSH source checkout, so the checkout must be built or runnable through `tsx`; the command does not duplicate DSH profile templates.
- Child processes run with `DSH_*` and secret-looking environment variables stripped, then the training ground's own `DSH_HOME` is injected.
- The command never installs plugins. Install them explicitly with `DSH_HOME=<ground> pnpm --dir deepseek/deepseek-harness dsh plugin --profile web add <package>`.
- Removing a ground leaves its `.pnpm-store` inside the ground directory, so the whole node is removed together.
