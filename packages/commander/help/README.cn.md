# @veren/commander-help

[English](./README.md)

veren CLI 的 `help` 命令 —— 标准 Cordis 插件模块：只注入命令注册表，注册
`help` 命令，其双语用法列表完全由已注册命令生成 —— 列表从不手工维护；
用法行前缀来自 schemastery 定义的 `Config` schema（`program`）。

## 何时使用

- 你组装 veren CLI 运行时（`apps/cli` 已包含本插件），希望用法输出与注册表
  自动保持同步。
- 你要在自己的 commander 工具里获得同样的注册表驱动帮助。

自己渲染帮助时请跳过本包。

## 安装

```json
{
  "dependencies": {
    "@veren/commander-help": "workspace:*"
  }
}
```

## 快速开始

```ts
import { Context } from '@deepseek-ai/cordis'
import * as CommandsHost from '@veren/commander-core'
import * as HelpCommand from '@veren/commander-help'

const ctx = new Context()
await ctx.plugin(CommandsHost) // 命令注册表
await ctx.plugin(HelpCommand)  // 注册 `help`（inject = [Commands]）
```

`@veren/commander-core` 的 `dispatch` 会自动把空参与任一 `config.helpFlags`
路由到本命令。用 `ctx.plugin(HelpCommand, { program: 'mycli' })` 自定义程序名。

## 令牌子路径（平台无关）

`./tokens` 只导出 `PROGRAM` 令牌（`program` 配置字段名）—— 不含 Cordis、
不含 Node 内置模块 —— 配置面板等平台无关消费方引用该字段时无需导入插件本体：

```ts
import { PROGRAM } from '@veren/commander-help/tokens' // 只有令牌，不拖入 Cordis
```

## 接口

模块即插件 —— 以命名空间导入装载（`ctx.plugin(...)`）：

| 导出 | 类型 | 说明 |
| --- | --- | --- |
| `name` | 字符串（`'verenCliHelpCommand'`） | 插件显示名。 |
| `inject` | `[Commands]` | 只依赖命令注册表，不需要项目服务。 |
| `Config` | schemastery schema | `{ program: string }` —— 用法行展示的程序名（缺省 `'pnpm cli'`）。 |
| `apply(ctx, config)` | 插件函数 | 注册 `help` 命令；注册 disposer 交还 fiber，插件卸载时命令自动注销。 |
| `printUsage(commands, config)` | 函数 | 渲染 `  <program> <usage>` 行（按名称排序）与各命令的双语摘要。 |
| `DEFAULT_PROGRAM` | 字符串（ `'pnpm cli'` ） | `program` 的缺省值，schema 与直接调用共用。 |

## 开发

```bash
pnpm --filter @veren/commander-help build
pnpm --filter @veren/commander-help test   # 3 个用例
```

```
packages/commander/help
├── src/
│   ├── help.ts        # Config schema + printUsage / 配置 schema 与用法渲染
│   ├── tokens.ts      # 平台无关的 PROGRAM 令牌 / platform-agnostic PROGRAM token
│   └── index.ts       # 插件模块 name/inject/Config/apply 与再导出 / plugin module + re-exports
└── test/index.test.ts
```

## 注意事项与约束

- 用法列表完全由已注册命令生成：装载新命令插件即更新帮助输出，本包无需改代码。
- help 命令随 fiber 卸载从注册表消失，与所有命令插件一致。
