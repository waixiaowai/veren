/**
 * commander profile 的启动插件：把 `dsh --profile commander ...` 的 argv
 * 交给命令注册表，并把结果转成 launcher 的退出码。
 *
 * The commander profile's startup plugin: hands `dsh --profile commander ...`
 * argv to the command registry and turns the outcome into the launcher's exit
 * code.
 *
 * 插件只注入命令注册表；Loader 的其它行（Project、Discovery、各命令）可能
 * 仍在激活，因此 dispatch 前先 await loader 的完成信号。
 *
 * The plugin injects only the command registry; other Loader rows (Project,
 * Discovery, the command plugins) may still be activating, so it awaits the
 * loader's settlement signal before dispatching.
 */

import type { Context } from '@deepseek-ai/cordis';
import { Commands } from '@veren/commander-core';
import { getOrThrow } from '@veren/core';

/** 插件显示名 / the plugin display name */
export const name = 'verenCommanderStartup';

/** 依赖命令注册表 / requires the command registry */
export const inject = [Commands];

/** launcher 提供的 argv 视图 / the launcher-provided argv view */
interface CmdlineArgsLike {
  /** 读取不可变 argv / read the immutable argv */
  get(): readonly string[];
}

/** Loader 的完成信号 / the loader's settlement signal */
interface LoaderLike {
  /** 等待整棵树完成激活 / wait for the whole tree to settle */
  await(): Promise<void>;
}

/**
 * 插件装配：读取 argv 与退出函数，异步等待 Loader 后分发。
 * Plugin assembly: reads argv and the exit function, then dispatches after the
 * Loader settles.
 */
export const apply = (ctx: Context): void => {
  const argv = (ctx.get('cmdlineArgs') as CmdlineArgsLike | undefined)?.get() ?? [];
  const exit = ctx.get('appExit') as ((code: number) => void) | undefined;
  void run(ctx, argv, exit);
};

/** 等待 Loader、分发并请求退出 / await the Loader, dispatch, and request exit */
async function run(
  ctx: Context,
  argv: readonly string[],
  exit: ((code: number) => void) | undefined,
): Promise<void> {
  let code = 0;
  try {
    await (ctx.get('loader') as LoaderLike | undefined)?.await();
    const commands = getOrThrow(ctx, Commands);
    await commands.dispatch(argv);
  } catch (error) {
    process.stderr.write(`cli: ${error instanceof Error ? error.message : String(error)}\n`);
    code = 1;
  }
  if (exit === undefined) process.exitCode = code;
  else exit(code);
}
