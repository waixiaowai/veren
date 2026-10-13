/**
 * @veren/commander-help —— help 命令插件：标准 Cordis 插件模块。
 *
 * @veren/commander-help — the help command plugin: a standard Cordis plugin
 * module.
 *
 * 遵循本仓库 Provider 约定（同 @veren/yaml-parser）：
 * Follows this repository's provider convention (same as @veren/yaml-parser):
 *   - name    插件显示名 / the plugin display name
 *   - inject  依赖的服务令牌 / required service tokens
 *   - Config  用 @deepseek-ai/schemastery 定义的插件配置 schema / the plugin
 *             config schema defined with @deepseek-ai/schemastery
 *   - apply   装配函数：向命令注册表注册 help 命令 / registers the help
 *             command with the command registry
 */

import type { Context } from '@deepseek-ai/cordis';
import { getOrThrow } from '@veren/core';
import { Commands } from '@veren/commander-core';
import { Config } from './help.js';
import { printUsage } from './help.js';

// Config 值导出同时携带同名接口的类型含义，供消费方在类型位置使用。
// The Config value export also carries the same-named interface's type
// meaning, so consumers can use it in type positions.
export { Config, DEFAULT_PROGRAM, printUsage } from './help.js';

/** 插件显示名 / the plugin display name */
export const name = 'verenCliHelpCommand';

/**
 * 只依赖命令注册表，不需要项目服务 —— 这也演示了命令插件可以按需注入
 * 最小依赖。
 * Only the command registry is required, not the project service — this also
 * demonstrates that command plugins inject the minimal dependencies they need.
 */
export const inject = [Commands];

/**
 * 插件装配：从上下文读取命令注册表，注册 help 命令，并把注册 disposer
 * 交还 fiber —— 插件卸载时命令自动注销。
 * Plugin assembly: reads the command registry from the context, registers the
 * help command, and hands the registration disposer back to the fiber — the
 * command disappears when the plugin unloads.
 */
export const apply = (ctx: Context, config: Config) => {
  const commands = getOrThrow(ctx, Commands);
  return commands.register({
    name: 'help',
    usage: 'help',
    summary: '显示本帮助 / show this help',
    run: () => printUsage(commands, config),
  });
};
