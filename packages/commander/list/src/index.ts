/**
 * @veren/commander-list —— list 命令插件：标准 Cordis 插件模块。
 *
 * @veren/commander-list — the list command plugin: a standard Cordis plugin
 * module.
 *
 * 遵循本仓库 Provider 约定（同 @veren/yaml-parser）：
 * Follows this repository's provider convention (same as @veren/yaml-parser):
 *   - name    插件显示名 / the plugin display name
 *   - inject  依赖的服务令牌 / required service tokens
 *   - Config  用 @deepseek-ai/schemastery 定义的插件配置 schema / the plugin
 *             config schema defined with @deepseek-ai/schemastery
 *   - apply   装配函数：向命令注册表注册 list 命令 / registers the list
 *             command with the command registry
 */

import type { Context } from '@deepseek-ai/cordis';
import { getOrThrow } from '@veren/core';
import { Commands } from '@veren/commander-core';
import { Discovery } from '@veren/commander-discovery';
import { Config } from './list.js';
import { cmdList } from './list.js';

export type { UnitSource } from './list.js';
// Config 值导出同时携带同名接口的类型含义，供消费方在类型位置使用。
// The Config value export also carries the same-named interface's type
// meaning, so consumers can use it in type positions.
export { cmdList, Config, DEFAULT_INDENT } from './list.js';

/** 插件显示名 / the plugin display name */
export const name = 'verenCliListCommand';

/** 依赖命令注册表与 Discovery 服务 / requires the command registry and the Discovery service */
export const inject = [Commands, Discovery];

/**
 * 插件装配：从上下文读取 Discovery 与命令注册表，注册 list 命令，并把注册
 * disposer 交还 fiber —— 插件卸载时命令自动注销。
 * Plugin assembly: reads the Discovery service and the command registry from
 * the context, registers the list command, and hands the registration disposer
 * back to the fiber — the command disappears when the plugin unloads.
 */
export const apply = (ctx: Context, config: Config) => {
  const source = getOrThrow(ctx, Discovery);
  return getOrThrow(ctx, Commands).register({
    name: 'list',
    usage: 'list',
    summary: '列出全部单元（JSON）/ list all units (JSON)',
    run: (args) => cmdList(source, config, args),
  });
};
