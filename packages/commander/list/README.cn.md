# @veren/commander-list

[English](./README.md)

veren CLI 的 `list` 命令 —— 标准 Cordis 插件模块：注入命令注册表与 Discovery
服务，注册 `list` 命令，把全部工作区单元 `{ name, description, dir }` 以 JSON 输出并按 `dir` 排序；JSON 缩进来自 schemastery 定义的 `Config`
schema（`indent`）。

## 何时使用

- 你组装 veren CLI 运行时（`apps/cli` 已包含本插件），需要单元清单命令。
- 你要在自己的 commander 工具里获得同样的 JSON 清单输出。

直接消费 `@veren/commander-discovery` 并自己渲染时请跳过本包。

## 安装

```json
{
  "dependencies": {
    "@veren/commander-list": "workspace:*"
  }
}
```

## 快速开始
```ts
import { Context } from '@deepseek-ai/cordis'
import * as YamlParser from '@veren/yaml-parser'
import * as CommandsHost from '@veren/commander-core'
import * as Discovery from '@veren/commander-discovery'
import * as Project from '@veren/commander-project'
import * as ListCommand from '@veren/commander-list'

const ctx = new Context()
await ctx.plugin(YamlParser)
await ctx.plugin(CommandsHost) // 命令注册表
await ctx.plugin(Project)
await ctx.plugin(Discovery)    // 单元清单服务（inject = [Project]）
await ctx.plugin(ListCommand)  // 注册 `list`（inject = [Commands, Discovery]）
```

配置以 `ctx.plugin(ListCommand, { indent: 4 })` 传入。

## 令牌子路径（平台无关）
`./tokens` 只导出 `INDENT` 令牌（`indent` 配置字段名）—— 不含 Cordis、不含 Node 内置模块 —— 配置面板等平台无关消费方引用该字段时无需导入插件本体。
```ts
import { INDENT } from '@veren/commander-list/tokens' // 只有令牌，不拖入 Cordis
```

## 接口

模块即插件 —— 以命名空间导入装载（`ctx.plugin(...)`）：

| 导出 | 类型 | 说明 |
| --- | --- | --- |
| `name` | 字符串（`'verenCliListCommand'`） | 插件显示名。 |
| `inject` | `[Commands, Discovery]` | 依赖命令注册表与 Discovery 服务。 |
| `Config` | schemastery schema | `{ indent: number }` —— JSON 缩进空格数（缺省 `2`，范围 `0..10`）。 |
| `apply(ctx, config)` | 插件函数 | 注册 `list` 命令；注册 disposer 交还 fiber，插件卸载时命令自动注销。 |
| `cmdList(source, config, args)` | 函数 | 实现：无参数输出全部单元；带一个 `<name>` 输出该子包 `dependencies` 解析出的单元（工作区条目 + 第三方依赖），同一 JSON 形状（未知名抛 code 为 `UNIT_NOT_FOUND` 的 `CliError`；多于一个参数抛 `CliError`）。 |
| `UnitSource` | 类型 | `Pick<DiscoveryService, 'list' \| 'listDependencies' \| 'find'>` —— 实现所需的最小结构视图。 |
| `DEFAULT_INDENT` | 数字（`2`） | `indent` 的缺省值，schema 与直接调用共用。 |

### list <name> / 子包依赖查询

- `pnpm cli list <name>`：输出该子包自身 `package.json` `dependencies` 的全部依赖，
  按清单顺序返回；工作区命中的直接复用 `list` 条目，第三方依赖从其 `node_modules`
  内的 `package.json` 读取 `name`/`description`（缺失元数据时 description 为空兜底）；
  未知包名或参数多于一个时抛 `CliError`。
  Prints the sub-package's `dependencies` resolved to units (workspace entries plus third-party
  packages from `node_modules`) in the same JSON shape; a `CliError` is thrown on an unknown name
  or more than one argument.

## 开发
```bash
pnpm --filter @veren/commander-list build
pnpm --filter @veren/commander-list test   # 6 个用例
```

```
packages/commander/list
├── src/
│   ├── list.ts        # Config schema + UnitSource + cmdList / 配置 schema、最小视图与实现
│   ├── tokens.ts      # 平台无关的 INDENT 令牌 / platform-agnostic INDENT token
│   └── index.ts       # 插件模块 name/inject/Config/apply 与再导出 / plugin module + re-exports
└── test/index.test.ts
```

## 注意事项与约束
- `list` 独占 stdout（纯 JSON），AI 消费方可以直接解析。
- `pnpm cli list <name>` 保持清单顺序：工作区命中复用清单条目，第三方依赖从 `node_modules` 内自身的 `package.json` 读取 `name`/`description`（description 为空兜底），因此每个依赖都会出现。
- 单元清单来自 `@veren/commander-discovery` 的 `Discovery` 服务；同目录下 npm
  单元优先于 Rust crate。
