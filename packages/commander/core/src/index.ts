/**
 * @veren/commander-core —— 命令注册表插件：标准 Cordis 插件模块。
 *
 * @veren/commander-core — the command registry plugin: a standard Cordis
 * plugin module.
 *
 * 遵循本仓库 Provider 约定（同 @veren/yaml-parser）：
 * Follows this repository's provider convention (same as @veren/yaml-parser):
 *   - name    服务令牌（兼作插件显示名）/ the service token (doubling as the
 *             plugin display name)
 *   - inject  依赖的服务令牌 / required service tokens
 *   - Config  用 @deepseek-ai/schemastery 定义的插件配置 schema / the plugin
 *             config schema defined with @deepseek-ai/schemastery
 *   - apply   装配函数：创建命令注册表服务并提供到上下文 / wires the command
 *             registry service into the context
 *
 * 组装（插件清单与 main）在 @veren/cli（apps/cli）。
 * Assembly (the plugin manifest and main) lives in @veren/cli (apps/cli).
 */

import type { Context } from '@deepseek-ai/cordis';
import { Config } from './commands.js';
import { CommandService, Commands } from './commands.js';
export type { CommandDef } from './commands.js';
// Config 值导出同时携带同名接口的类型含义，供消费方在类型位置使用。
// The Config value export also carries the same-named interface's type
// meaning, so consumers can use it in type positions.
export { CliError, CommandService, Config, DEFAULT_HELP_FLAGS } from './commands.js';
// 令牌与最小结构视图定义在平台无关的 ./tokens.ts；平台无关消费方（如浏览器）
// 也可以从 `@veren/commander-core/tokens` 子路径单独导入，避免拖入 Cordis。
// The tokens and their minimal structural views live in the platform-
// independent ./tokens.ts; platform-agnostic consumers (such as the browser)
// may import them alone from the `@veren/commander-core/tokens` subpath,
// keeping Cordis out of their bundles.
export { Commands } from './tokens.js';
export type { CommandRegistry } from './tokens.js';

/** 服务令牌：同时作为插件显示名 / the service token, doubling as the plugin display name */
export { Commands as name };

/** 无依赖，可最先激活 / dependency-free, activatable first */
export const inject = [];

/**
 * 插件装配：创建命令注册表。Service 构造时即以 Commands 令牌把自己注册到
 * 上下文，并随本插件 fiber 卸载自动注销（不要返回实例 —— 插件返回值会被
 * 当作 effect disposer）。
 * Plugin assembly: creates the command registry. The Service registers itself
 * under the Commands token on construction and unregisters automatically when
 * this plugin's fiber unloads (never return the instance — a plugin's return
 * value is treated as an effect disposer).
 */
export const apply = (ctx: Context, config: Config) => {
  new CommandService(ctx, config);
};
