# @veren/commander-project

[涓枃鏂囨。](./README.cn.md)

The veren project info as a Cordis service: locates the project root (walks up to `.veren.yaml`), loads the `scan` config through the `@veren/yaml-parser` service, and provides `{ root, config }` under the `Project` token.

## When to use

- A Cordis plugin needs the project root or the unit-scan roots 鈥?inject `Project` instead of re-reading `.veren.yaml`.
- You load veren project config in your own tool and want the YAML parsing to come from the context.

Skip it when you parse your own config formats.

## Install

```json
{
  "dependencies": {
    "@veren/commander-project": "workspace:*"
  }
}
```

At runtime the context must provide the `@veren/yaml-parser` service (`verenYamlParser`), declared via this plugin's `inject`.

## Quick start

```ts
import { Context } from '@deepseek-ai/cordis'
import * as YamlParser from '@veren/yaml-parser'
import { Project, ProjectPlugin } from '@veren/commander-project'

const ctx = new Context()
await ctx.plugin(YamlParser)
await ctx.plugin(ProjectPlugin) // locates the root from cwd and loads .veren.yaml

const project = ctx.get(Project.name)! // { root: '/鈥?, config: { scanRoots: ['/鈥?apps', 鈥 } }
```

`scan` defaults to `['apps', 'packages', 'cargos']` (relative to `.veren.yaml`) and must be a string array when present; missing scan roots throw.

## API

| Export | Kind | Description |
| --- | --- | --- |
| `Project` | token, the string `'verenCliProject'` | Token under which the project info service is provided. |
| `ProjectInfo` | interface | `{ root, config }` 鈥?the `.veren.yaml` directory and the parsed config. |
| `ProjectPlugin` | plugin object | Locates the root, loads the config, provides `Project`; `inject = ['verenYamlParser']`. |
| `findProjectRoot(fs, path, startDir?)` | async function | Takes the injected `@veren/node-fs` / `@veren/node-path` services; walks up from `startDir` (default cwd) to the directory holding `.veren.yaml`; throws a `CliError` when absent. |
| `loadConfig(root, parser, fs, path)` | async function | Parses `.veren.yaml` through the YAML parser service; `scan` falls back to `DEFAULT_SCAN_ROOTS`, invalid types or missing roots throw. |
| `CONFIG_FILE` / `DEFAULT_SCAN_ROOTS` | constants | `'.veren.yaml'` / `['apps', 'packages', 'cargos']`. |
| `Config` | interface | `{ scanRoots: string[] }` (absolute paths). |

## Development

```bash
pnpm --filter @veren/commander-project build
pnpm --filter @veren/commander-project test   # 7 cases / 7 涓敤渚?```

```
packages/commander/project
鈹溾攢鈹€ src/project.ts     # root discovery + config loading + Project service / 椤圭洰鏈嶅姟
鈹溾攢鈹€ src/index.ts       # re-exports / 鍐嶅鍑?鈹斺攢鈹€ test/index.test.ts
```

## Notes & constraints

- `findProjectRoot` starts at `process.cwd()` by default; run the CLI from inside the veren project or pass an explicit start dir.
- `.veren.yaml` parsing fails fast via `getOrThrow` when the YAML parser service is missing from the context.

