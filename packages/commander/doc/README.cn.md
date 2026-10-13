# @veren/commander-doc

[English](./README.md)

veren CLI 的 `doc` 命令 —— 标准 Cordis 插件模块：注入命令注册表与 Discovery
服务，注册 `doc` 命令，原文输出单元的双语 README —— 中文优先标志来自
schemastery 定义的 `Config` schema（`cnFlags`），另一语言兜底。

## 何时使用

- 你组装 veren CLI 运行时（`apps/cli` 已包含本插件），需要按单元查文档的命令。
- 你要在自己的 commander 工具里原样输出 README（不加任何修饰）。

自己读 README 文件时请跳过本包。

## 安装

```json
{
  "dependencies": {
    "@veren/commander-doc": "workspace:*"
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
import * as DocCommand from '@veren/commander-doc'

const ctx = new Context()
await ctx.plugin(YamlParser)
await ctx.plugin(CommandsHost) // 命令注册表
await ctx.plugin(Project)
await ctx.plugin(Discovery)    // 单元清单服务（inject = [Project]）
await ctx.plugin(DocCommand)   // 注册 `doc`（inject = [Commands, Discovery]）
```

配置经 `ctx.plugin(DocCommand, { cnFlags: ['--zh'] })` 传入。

## 令牌子路径（平台无关）

`./tokens` 只导出 `CN_FLAGS` 令牌（`cnFlags` 配置字段名）—— 不含 Cordis、
不含 Node 内置模块 —— 配置面板等平台无关消费方引用该字段时无需导入插件本体：

```ts
import { CN_FLAGS } from '@veren/commander-doc/tokens' // 只有令牌，不拖入 Cordis
```

## 接口

模块即插件 —— 以命名空间导入装载（`ctx.plugin(...)`）：

| 导出 | 类型 | 说明 |
| --- | --- | --- |
| `name` | 字符串（`'verenCliDocCommand'`） | 插件显示名。 |
| `inject` | `[Commands, Discovery]` | 依赖命令注册表与 Discovery 服务。 |
| `Config` | schemastery schema | `{ cnFlags: string[] }` —— 触发中文优先的 argv 标志（缺省 `['--cn', '-c']`）。 |
| `apply(ctx, config)` | 插件函数 | 注册 `doc` 命令；注册 disposer 交还 fiber，插件卸载时命令自动注销。 |
| `cmdDoc(source, config, args)` | 函数 | 实现：中文标志可出现在任意位置，首个非标志参数即单元名；首选语言在前，另一语言兜底；stdout 原样输出。 |
| `locateUnit(source, name)` | 函数 | 按名定位单元；未命中抛出双语 `CliError` 并列出全部可用名。 |
| `UnitSource` | 类型 | `Pick<DiscoveryService, 'find' \| 'list' \| 'root'>` —— 实现所需的最小结构视图（任何具备这三个成员的对象均可）。 |

## 开发

```bash
pnpm --filter @veren/commander-doc build
pnpm --filter @veren/commander-doc test   # 8 个用例
```

```
packages/commander/doc
├── src/
│   ├── doc.ts         # Config schema + UnitSource + cmdDoc + locateUnit / 配置 schema、最小视图与实现
│   ├── tokens.ts      # 平台无关的 CN_FLAGS 令牌 / platform-agnostic CN_FLAGS token
│   └── index.ts       # 插件模块 name/inject/Config/apply 与再导出 / plugin module + re-exports
└── test/index.test.ts
```

## 注意事项与约束

- 按 AGENTS.md 约定每个单元都必须有 `README.md` 与 `README.cn.md`；单元两个都没有
  时 `doc` 报错，且只读这两个文件名。
- 输出原样不加修饰 —— stdout 保持干净，方便 AI 消费方解析。
- 实现只依赖结构化的 `UnitSource` 视图，测试与内嵌方都可以提供自己的
  `find`/`list`/`root` 实现。
