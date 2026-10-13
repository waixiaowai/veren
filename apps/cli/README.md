# @veren/cli

[中文文档](./README.cn.md)

The veren CLI executable entry: a thin shell plus the assembly layer. It owns the plugin manifest — which capability and command plugins run — while every capability itself lives in the plugin packages under `packages/commander/*` (`@veren/commander-core` framework, `@veren/commander-project` project service, `@veren/commander-discovery`, and the `list`/`doc`/`help` command plugins).

## When to use

- You want to run the CLI: `pnpm cli <command>` from the repository root.
- You want to add, remove or replace commands for the veren CLI: edit the manifest in `src/runtime.ts`.
- You (or an AI agent) need an inventory of the workspace's units — `{ name, description, dir }` — or want to read a unit's bilingual README verbatim.

Skip it when you compose your own runtime: depend on `@veren/commander-core` and the individual `@veren/commander-*` packages directly instead.

## Usage

Run from anywhere inside the repository through the root `cli` script (after `pnpm build`, because the `@veren/commander-*` packages resolve to their dist output):

```bash
pnpm cli list                # all units as JSON / 全部单元（JSON）
pnpm cli doc <name>          # print README.md verbatim / 原文输出 README.md
pnpm cli doc <name> --cn     # print README.cn.md verbatim / 原文输出 README.cn.md
pnpm cli help                # bilingual usage from the registry / 注册表生成的双语用法
```

`list` owns stdout exclusively: it prints nothing but the JSON array `[{ name, description, dir }, ...]`, sorted by `dir`, so agents can parse it trivially. `doc` prints the README verbatim with the other language as fallback. Errors go to stderr with a non-zero exit code and bilingual messages.

Configuration, command behavior and the framework are documented in the `packages/commander/*` packages: `.veren.yaml` at the project root drives unit discovery, and commands are Cordis plugins registered into the command service.

## The assembly layer

`src/runtime.ts` is the plugin manifest — the only place that changes when commands come and go:

```ts
export async function createRuntime(): Promise<Context> {
  const ctx = new Context()
  // capability plugins / 能力插件
  await ctx.plugin(YamlParser)      // YAML parsing (@veren/yaml-parser)
  await ctx.plugin(CliCommands)     // the command registry (@veren/commander-core)
  await ctx.plugin(ProjectPlugin)   // project info (@veren/commander-project)
  // command plugins / 命令插件
  await ctx.plugin(ListCommand)     // @veren/commander-list
  await ctx.plugin(DocCommand)      // @veren/commander-doc
  await ctx.plugin(HelpCommand)     // @veren/commander-help
  return ctx
}
```

`src/cli.ts` composes the runtime, dispatches argv through `@veren/commander-core`'s `dispatch` and exits with code 1 on errors — that is the whole shell.

Adding a command = write a plugin against `@veren/commander-core` (smallest example: `@veren/commander-help`) and add one line to the manifest.

## Development

```bash
pnpm build                      # build workspace packages (needed by pnpm cli)
pnpm --filter @veren/cli build  # type-check only (noEmit) / 仅类型检查
pnpm --filter @veren/cli test   # vitest unit tests / vitest 单测
```

```
apps/cli
├── README.md             # English docs
├── README.cn.md          # Chinese docs
├── package.json
├── src/
│   ├── cli.ts            # entry: compose + dispatch + error exit / 入口：组合、分发与错误出口
│   └── runtime.ts        # assembly layer: the plugin manifest / 组装层：插件清单
└── test/
    └── runtime.test.ts   # 4 cases (dispatch + manifest integration) / 分发与清单集成
```

Tests install the real manifest and cover dispatch routing (unknown command, help aliases, `list` JSON output) — the framework and commands themselves are covered by the `packages/commander/*` suites (37 cases).
