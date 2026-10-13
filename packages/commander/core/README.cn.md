# @veren/commander-core

[English](./README.md)

veren 命令注册表 —— 标准 Cordis 插件模块：`CommandDef`、`CommandService`
注册表（继承 `Service`，提供 `register`/`get`/`list`/`dispatch`）、统一错误
`CliError`，以及用 schemastery 定义的 `Config` schema（`helpFlags`）。

## 何时使用

- 你为 veren CLI（或自己的 commander 工具）编写 Cordis 插件命令，需要 `Commands`
  令牌来注册。
- 你想在自己的入口里内嵌命令注册表 / 分发器，且不需要 veren 内置命令。

只运行 CLI 时请跳过本包：用 `@veren/cli`。

## 安装

```json
{
  "dependencies": {
    "@veren/commander-core": "workspace:*"
  }
}
```

## 快速开始

```ts
import { Context } from '@deepseek-ai/cordis'
import { getOrThrow } from '@veren/core'
import { Commands } from '@veren/commander-core'
import * as RegistryPlugin from '@veren/commander-core'

const ctx = new Context()
await ctx.plugin(RegistryPlugin) // name/inject/Config/apply —— schema 缺省值自动补全
getOrThrow(ctx, Commands).register({
  name: 'hello',
  usage: 'hello <who>',
  summary: '打招呼 / say hello',
  run: (args) => process.stdout.write(`hello ${args[0] ?? 'world'}\n`),
})
await getOrThrow(ctx, Commands).dispatch(['hello']) // 空参 / --help / -h 路由到 `help`
```

配置经 `ctx.plugin(RegistryPlugin, { helpFlags: ['/h'] })` 传入：`apply` 运行前
会先按 `Config` schema 校验并补全缺省值。

## 令牌子路径（平台无关）

`./tokens` 只导出 `Commands` 令牌及其结构化视图 `CommandRegistry` /
`CommandDefView` —— 不含 Cordis、不含 Node 内置模块 —— 可干净地打进浏览器或
其他只需要引用服务名的环境：

```ts
import { Commands } from '@veren/commander-core/tokens' // 只有令牌，不拖入 Cordis
```

## 接口

模块即插件 —— 以命名空间导入装载（`ctx.plugin(...)`）：

| 导出 | 类型 | 说明 |
| --- | --- | --- |
| `name` | 字符串（`'verenCliCommands'`） | 服务令牌（= `Commands`）兼插件显示名。 |
| `inject` | `[]` | 无依赖，可最先激活。 |
| `Config` | schemastery schema | `{ helpFlags: string[] }` —— 路由到 `help` 的 argv 标志（缺省 `['--help', '-h']`）。 |
| `apply(ctx, config)` | 插件函数 | 创建 `CommandService` 并提供到上下文。 |
| `Commands` | 令牌，字符串 `'verenCliCommands'` | `CommandService` 的提供令牌。 |
| `CommandService` | 继承 `Service` 的类 | `register(def)`（返回注销 disposer，重名立即报错）、`get(name)`、`list()`（按名称排序）、`dispatch(argv)`（按 `argv[0]` 路由；空参或命中任一 `config.helpFlags` 路由到 `help`；未知命令抛出双语 `CliError` 并列出全部可用命令）。 |
| `CommandDef` | 接口 | `{ name, usage, summary, run(args) }` —— 每个命令插件注册的形状。 |
| `CommandRegistry` | 接口 | 令牌级结构视图（来自 `./tokens`）：`register`/`get`/`list`/`dispatch`，无 Cordis 依赖。 |
| `CliError` | 继承 `Error` 的类 | 命令框架统一错误：CLI 主入口在 stderr 打印的双语消息。 |
| `DEFAULT_HELP_FLAGS` | `readonly string[]` | `helpFlags` 的缺省值，schema 与直接构造共用。 |

## 开发

```bash
pnpm --filter @veren/commander-core build
pnpm --filter @veren/commander-core test   # 10 个用例
```

```
packages/commander/core
├── src/
│   ├── commands.ts   # CommandDef + Config schema + CommandService（含 dispatch）+ CliError / 命令契约、配置 schema 与注册表服务
│   ├── tokens.ts     # 平台无关的 Commands 令牌 + CommandRegistry/CommandDefView / platform-agnostic token + views
│   └── index.ts      # 插件模块 name/inject/Config/apply 与再导出 / plugin module + re-exports
└── test/index.test.ts
```

## 注意事项与约束

- 令牌是带 `veren` 前缀的普通字符串，跨包不会冲突。
- `Service` 子类构造时即自我注册；绝不要把实例从插件 `apply` 返回（插件返回值
  会被当作 effect disposer）。
- `ctx.get` 对带 tracker 的服务每次返回新的 traceable 包装 —— 测试中不要按同一性
  比较代理，也不要用 `instanceof` 探测。
