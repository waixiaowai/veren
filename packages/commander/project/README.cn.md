# @veren/commander-project

[English](./README.md)

把 veren 项目信息变成 Cordis 服务：向上查找 `.veren.yaml` 定位项目根，经 `@veren/yaml-parser` 服务加载 `scan` 配置，并以 `Project` 令牌提供 `{ root, config }`。

## 何时使用

- Cordis 插件需要项目根或单元扫描根 —— 注入 `Project`，不要自行重读 `.veren.yaml`。
- 你在自己的工具中加载 veren 项目配置，且希望 YAML 解析能力来自上下文。

如果解析的是自己的配置格式，请跳过本包。

## 安装

```json
{
  "dependencies": {
    "@veren/commander-project": "workspace:*"
  }
}
```

运行时上下文必须已提供 `@veren/yaml-parser` 服务（`verenYamlParser`），本插件已通过
`inject` 声明该依赖。

## 快速开始
```ts
import { Context } from '@deepseek-ai/cordis'
import * as YamlParser from '@veren/yaml-parser'
import { Project, ProjectPlugin } from '@veren/commander-project'

const ctx = new Context()
await ctx.plugin(YamlParser)
await ctx.plugin(ProjectPlugin) // 从 cwd 定位项目根并加载 .veren.yaml

const project = ctx.get(Project.name)! // { root: '/…', config: { scanRoots: ['/…/apps', …] } }
```

`scan` 缺省回退 `['apps', 'packages', 'cargos']`（相对 `.veren.yaml`）；存在时必须是
字符串数组，扫描根不存在会抛错。

## 接口

| 导出 | 类型 | 说明 |
| --- | --- | --- |
| `Project` | 令牌，字符串 `'verenCliProject'` | 项目信息服务注册到的令牌。 |
| `ProjectInfo` | 接口 | `{ root, config }` —— `.veren.yaml` 所在目录与解析后的配置。 |
| `ProjectPlugin` | 插件对象 | 定位根、加载配置、提供 `Project`；`inject = ['verenYamlParser']`。 |
| `findProjectRoot(startDir?)` | 函数 | 从 `startDir`（默认 cwd）向上查找 `.veren.yaml` 所在目录；缺失时抛 `CliError`。 |
| `loadConfig(root, ctx)` | 函数 | 经 YAML 解析服务解析 `.veren.yaml`；`scan` 缺省回退 `DEFAULT_SCAN_ROOTS`，类型不合法或扫描根缺失抛错。 |
| `CONFIG_FILE` / `DEFAULT_SCAN_ROOTS` | 常量 | `'.veren.yaml'` / `['apps', 'packages', 'cargos']`。 |
| `Config` | 接口 | `{ scanRoots: string[] }`（绝对路径）。 |

## 开发
```bash
pnpm --filter @veren/commander-project build
pnpm --filter @veren/commander-project test   # 7 个用例
```

```
packages/commander/project
├── src/project.ts     # 项目根定位 + 配置加载 + Project 服务 / root discovery + config + service
├── src/index.ts       # 再导出 / re-exports
└── test/index.test.ts
```

## 注意事项与约束
- `findProjectRoot` 默认从 `process.cwd()` 开始；请在 veren 项目内运行 CLI，或显式
  传入起始目录。
- 上下文缺少 YAML 解析服务时，`.veren.yaml` 解析会经 `getOrThrow` 立即失败。
