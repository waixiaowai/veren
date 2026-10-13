# @veren/cli

[English](./README.md)

veren CLI 可执行入口：薄壳 + 组装层。它持有插件清单 —— 决定哪些能力与命令插件
运行 —— 而所有能力本身都在 `packages/commander/*` 插件包内（`@veren/commander-core`
框架、`@veren/commander-project` 项目服务、`@veren/commander-discovery` 单元发现，
以及 `list`/`doc`/`help` 命令插件）。

## 何时使用

- 你想运行 CLI：在仓库根目录执行 `pnpm cli <command>`。
- 你想为 veren CLI 增删或替换命令：编辑 `src/runtime.ts` 中的清单。
- 你（或 AI 代理）需要工作区单元清单 —— `{ name, description, dir }` —— 或想原样读取
  某个单元的双语 README。

如果你要组装自己的运行时，请跳过本包：直接依赖 `@veren/commander-core` 与单个
`@veren/commander-*` 包。

## 用法

在仓库内任意位置通过根 `cli` 脚本运行（先 `pnpm build`，`@veren/commander-*` 包经
dist 产物解析）：

```bash
pnpm cli list                # 全部单元（JSON）/ all units as JSON
pnpm cli doc <name>          # 原文输出 README.md / print README.md verbatim
pnpm cli doc <name> --cn     # 原文输出 README.cn.md / print README.cn.md verbatim
pnpm cli help                # 注册表生成的双语用法 / bilingual usage from the registry
```

`list` 独占 stdout：除 JSON 数组 `[{ name, description, dir }, ...]` 外不输出任何内容，
按 `dir` 排序，方便代理直接解析。`doc` 原样输出 README，首选语言缺失时回退另一语言。
错误信息为双语，走 stderr，退出码非 0。

配置、命令行为与框架见 `packages/commander/*` 各包文档：项目根的 `.veren.yaml` 驱动
单元发现；命令是注册进命令服务的 Cordis 插件。

## 组装层

`src/runtime.ts` 就是插件清单 —— 命令增减时唯一需要改动的地方：

```ts
export async function createRuntime(): Promise<Context> {
  const ctx = new Context()
  // 能力插件 / capability plugins
  await ctx.plugin(YamlParser)      // YAML 解析（@veren/yaml-parser）
  await ctx.plugin(CliCommands)     // 命令注册表（@veren/commander-core）
  await ctx.plugin(ProjectPlugin)   // 项目信息（@veren/commander-project）
  // 命令插件 / command plugins
  await ctx.plugin(ListCommand)     // @veren/commander-list
  await ctx.plugin(DocCommand)      // @veren/commander-doc
  await ctx.plugin(HelpCommand)     // @veren/commander-help
  return ctx
}
```

`src/cli.ts` 组合运行时、经 `@veren/commander-core` 的 `dispatch` 分发 argv，出错时以
退出码 1 结束 —— 这就是外壳的全部。

新增命令 = 按 `@veren/commander-core` 契约写一个插件（最小示例见
`@veren/commander-help`），并在清单中加一行。

## 开发

```bash
pnpm build                      # 构建工作区包（pnpm cli 的前置条件）
pnpm --filter @veren/cli build  # 仅类型检查（noEmit）/ type-check only
pnpm --filter @veren/cli test   # vitest 单测 / vitest unit tests
```

```
apps/cli
├── README.md             # 英文文档
├── README.cn.md          # 中文文档
├── package.json
├── src/
│   ├── cli.ts            # 入口：组合、分发与错误出口 / entry: compose + dispatch + error exit
│   └── runtime.ts        # 组装层：插件清单 / assembly layer: the plugin manifest
└── test/
    └── runtime.test.ts   # 4 个用例（分发与清单集成 / dispatch + manifest integration）
```

测试装载真实清单，覆盖分发路由（未知命令、help 别名、`list` JSON 输出）—— 框架与
命令本身由 `packages/commander/*` 各套件覆盖（37 个用例）。
