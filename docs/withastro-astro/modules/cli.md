---
title: CLI 命令行入口
description: "cli 是唯一把 文本意图 翻译成 受控运行 的模块：它解析参数、选择命令、创建日志与提示器、启动对应模块，并把结果收敛为退出码。它不解析项目内容、不渲染页面、不写产物，所有领域行为都委托给出站模块；与 tooling 的分界是：cli 负责对项目执行动作（运行、构建、检查、添加集成），tooling 负责对编辑器与新建项目提供能力"
sidebar:
  order: 2
  label: CLI 命令行入口
draft: false
lastUpdated: 2026-11-04
---

## 2. CLI

`cli` 是唯一把"文本意图"翻译成"受控运行"的模块：它解析参数、选择命令、创建日志与提示器、启动对应模块，并把结果收敛为退出码。它不解析项目内容、不渲染页面、不写产物，所有领域行为都委托给出站模块；与 `tooling` 的分界是：`cli` 负责对**项目**执行动作（运行、构建、检查、添加集成），`tooling` 负责对**编辑器与新建项目**提供能力。

### 2.1 Duties

| 属于 | 不属于 |
| --- | --- |
| 参数词法解析、命令识别、`--help`/`--version` 输出 | 读取或合并项目配置（委托 `config`） |
| 日志器与文本样式、交互提示（选择、确认、输入） | 页面渲染、路由匹配（委托 `render`/`routing`） |
| 命令生命周期内的错误格式化与退出码 | 产物写盘与清理（委托 `build`） |
| 遥测开关与偏好设置（`telemetry`、`preferences`） | 集成内部行为（委托 `integrations`） |
| 把命令行参数折叠为一次"内联配置"输入 | 判断配置是否合法（委托 `config` 的校验） |

命令全集：`add`、`build`、`check`、`create-key`、`dev`、`docs`、`help`、`info`、`preferences`、`preview`、`sync`、`telemetry`、`version`。未知子命令回落为帮助输出而不是报错堆栈。

### 2.2 Capabilities

一次命令执行分五步：解析（词法 + 别名）、选择（命令注册表 + 是否可直接运行）、装配（日志器、样式器、版本提供方、帮助显示器、运行器）、执行（命令自身逻辑，可能再调用 `config`/`server`/`build`）、收敛（成功摘要或错误格式化 + 退出码）。可直接运行的命令（`help`、`version`）不解析项目配置；`info` 需要配置但不需要服务器；`dev`/`preview` 是长驻进程，`build`/`sync`/`check` 是一次性作业。参数到配置的映射只保留有公开语义的项：`--root`、`--config`、`--site`、`--base`、`--outDir`、`--mode`、`--port`、`--host`、`--open`、`--allowed-hosts`、`--verbose`、`--silent`、`--json`、`--force`、`--timings`；其余参数只影响该命令本地行为。日志有四种目的地：终端人类可读、JSON 行、组合、静默；`--json` 时输出必须逐行可解析，供 CI 消费。错误分两类：**用户可修复**（配置非法、缺少适配器、参数冲突）打印码、标题、提示与文档链接后以 1 退出；**内部缺陷**附带栈与最小复现信息。管道提前关闭（`EPIPE`）不视为崩溃，直接安静退出。

### 2.3 Contracts

```ts
type CommandName =
  | 'add' | 'build' | 'check' | 'create-key' | 'dev' | 'docs' | 'help'
  | 'info' | 'preferences' | 'preview' | 'sync' | 'telemetry' | 'version';

interface CliInvocation {
  command: CommandName;            // 已解析的命令，未知值回落 'help'
  cwd: string;                     // 进程工作目录，绝对路径
  flags: Readonly<Record<string, string | number | boolean | string[] | undefined>>;
  stdio: 'inherit' | 'pipe';       // 交互式提示需要 inherit
}

interface CliContext {
  logger: AstroLogger;             // 目的地由 --json/--verbose/--silent 决定
  stderr: NodeJS.WritableStream;
  stdin: NodeJS.ReadableStream | null;
  version: string;                 // 构建期注入的版本号
  isInteractive: boolean;          // TTY 且未禁用提示
}

interface CommandResult {
  exitCode: 0 | 1;                 // 0 成功；1 用户错误或作业失败
  summary?: string;                // 成功摘要的一行文本，供 --json 复用
}

interface Command<TOptions> {
  help: HelpPayload;               // 用法、参数、示例
  run(invocation: CliInvocation, context: CliContext, options: TOptions): Promise<CommandResult>;
}

abstract class CommandRunner {
  abstract run<T extends Command<unknown>>(
    command: T,
    invocation: CliInvocation,
    context: CliContext,
    options: Parameters<T['run']>[2],
  ): Promise<CommandResult>;
}
```

错误约定：命令内部不直接 `process.exit`，而是抛出携带稳定码的错误（如 `UnknownCLIError`），由执行器统一格式化；仅 `EPIPE` 与信号中断走快速退出分支。`--json` 模式下错误也必须是单行 JSON 对象，包含 `code`、`message`、`hint?`。

### 2.4 Flow

下面伪代码说明一次 `dev` 调用如何从参数走到长驻服务器；失败分支覆盖"参数冲突""配置非法""端口占用"。

```ts
async function runCli(argv: string[], ctx: CliContext): Promise<CommandResult> {
  const parsed = parseArgv(argv);                       // 词法解析，保留未知键供命令自用
  const invocation = resolveInvocation(parsed, ctx.cwd); // 未知命令 -> 'help'
  if (invocation.command === 'help' || invocation.command === 'version') {
    return { exitCode: 0, summary: showHelp(invocation.command, ctx) };
  }
  const command = registry[invocation.command];
  try {
    return await runner.run(command, invocation, ctx, command.parseOptions?.(invocation.flags));
  } catch (error) {
    const formatted = formatCliError(error, ctx);       // 码 + 标题 + 提示 + 文档链接
    ctx.stderr.write(formatted);
    recordFatalTelemetry(invocation.command, error);    // 不阻塞退出超过 400ms
    return { exitCode: 1 };
  }
}

async function runDev(invocation: CliInvocation, ctx: CliContext): Promise<CommandResult> {
  const config = await resolveConfig(toInlineConfig(invocation.flags), 'dev');
  const handle = await startDevServer({ config, logger: ctx.logger, flags: invocation.flags });
  await ctx.logger.info('dev', `ready at ${handle.url}`);
  if (!ctx.isInteractive) return { exitCode: 0, summary: handle.url };
  return await waitForShutdown(handle);                 // Ctrl+C / stdin 'q' 后关闭并返回 0
}
```

关键失败处理：`port` 被占用时先按配置重试下一个可用端口，仍失败则报 `UnknownCLIError`（消息含被占用端口与可用参数）；`--open` 打开浏览器失败只警告不回滚服务器；配置非法时由 `config` 抛错，`cli` 只负责格式化，不重复解释。

### 2.5 Acceptance

| 编号 | 前置条件 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| A-2-01 | 任意项目 | `astro --help` | 列出全部命令与 `--help` 提示，退出码 0 |
| A-2-02 | 未安装依赖的新目录 | `astro build` | 以退出码 1 失败，错误包含码、原因与下一步（安装依赖），无未捕获栈 |
| A-2-03 | 配置 `output: 'server'` 但无适配器 | `astro build` | 输出 `NoAdapterInstalled`，退出码 1，提示安装适配器 |
| A-2-04 | 端口 4321 已被占用 | `astro dev --port 4321` | 自动换端口或明确报错；日志给出实际 URL，不出现半启动状态 |
| A-2-05 | CI 环境（非 TTY） | `astro build --json` | 每行均为合法 JSON；不含交互提示；退出码与人类模式一致 |
| A-2-06 | 管道下游提前退出 | `astro check \| head -1` | 进程安静退出，退出码 1，不打印 `EPIPE` 栈 |
