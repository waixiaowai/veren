/**
 * @veren/cli —— veren CLI 可执行入口（薄壳 + 组装层）。
 * @veren/cli — the veren CLI executable entry (thin shell + assembly layer).
 *
 * 职责 / responsibilities:
 *   - ./runtime.ts  组装层：装载插件清单（能力全部来自 packages/commander/* 插件包）
 *     ./runtime.ts  the assembly layer: installs the plugin manifest (all
 *                   capabilities come from the packages/commander/* plugin packages)
 *   - ./cli.ts      本文件：组合运行时并分发 argv，统一错误出口
 *     ./cli.ts      this file: composes the runtime, dispatches argv, unified error exit
 *
 * 命令 / commands: list / doc / help（由插件注册，见 `pnpm cli help`）。
 * commands: list / doc / help (registered by plugins, see `pnpm cli help`).
 *
 * 运行方式 / How to run:
 *   `pnpm cli <command>`（根 package.json 的 cli 脚本代理到本文件）。
 *   先 `pnpm build`：依赖的 @veren 包经 dist 产物解析。
 *   `pnpm cli <command>` (the root "cli" script proxies to this file).
 *   Run `pnpm build` first: the @veren packages resolve to their dist output.
 */

import { Commands } from '@veren/commander-core';
import { getOrThrow } from '@veren/core';
import { createRuntime } from './runtime.ts';

/**
 * CLI 主入口：组合运行时并经注册表服务分发；任何错误走 stderr 并置非零退出码。
 * The CLI main entry: composes the runtime and dispatches through the registry
 * service; any error goes to stderr with a non-zero exit code.
 */
function main(argv: readonly string[]): void {
  createRuntime()
    .then((ctx) => getOrThrow(ctx, Commands).dispatch(argv))
    .catch((error) => {
      // 统一错误出口：信息走 stderr，退出码非 0，供 AI 侧识别失败并自纠。
      // Single error exit: message on stderr, non-zero code, so AI callers can detect and self-correct.
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(`cli: ${message}\n`);
      process.exitCode = 1;
    });
}

main(process.argv.slice(2));
