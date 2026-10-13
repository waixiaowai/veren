/**
 * @veren/node-path —— Node 路径 Provider：把 node:path 以 Cordis 服务
 * 提供到上下文。
 * @veren/node-path — the Node path provider: exposes node:path as a Cordis
 * context service.
 *
 * 遵循本仓库 Provider 约定（同 @veren/yaml-parser）：
 * Follows this repository's provider convention (same as @veren/yaml-parser):
 *   - name    服务令牌 / the service token
 *   - inject  依赖的服务令牌 / required service tokens
 *   - Config  用 @deepseek-ai/schemastery 定义的插件配置 schema / the plugin
 *             config schema defined with @deepseek-ai/schemastery
 *   - apply   装配函数：创建路径服务并提供到上下文 / wires the path service
 */

import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { provide } from '@veren/core';
import { createNodePath } from './service.js';
import type { NodePath } from './tokens.js';
import { verenNodePath as name } from './tokens.js';
export type { NodePath };
export { name };

/** 无依赖的服务：不依赖任何其他服务，可最先激活 / dependency-free service, activatable first */
export const inject = [];

/**
 * 插件配置 schema：声明委托的路径风格，默认跟随当前操作系统。
 * The plugin config schema: declares the path flavor, defaulting to the
 * current operating system.
 */
export const Config = z.object({
  /** 路径风格：posix(/) 或 win32(\) / the path flavor: posix (/) or win32 (\) */
  platform: z.union([z.const('posix'), z.const('win32')]).default(
    // 跟随宿主操作系统，跨平台消费方也可显式固定。
    // Follows the host OS; cross-platform consumers may pin it explicitly.
    process.platform === 'win32' ? 'win32' : 'posix',
  ),
});

/** 归一化后的插件配置 / the normalized plugin config */
export interface Config {
  /** 路径风格：posix(/) 或 win32(\) / the path flavor: posix (/) or win32 (\) */
  platform: 'posix' | 'win32';
}

/**
 * 创建路径服务并以 name 提供到上下文；返回取消提供的 disposer。
 * config 应先经 Config schema 归一化（ctx.plugin 加载时自动完成）。
 *
 * Creates the path service, provides it under name, and returns the
 * unregistering disposer. The config must be normalized through the Config
 * schema first (automatic via ctx.plugin).
 */
export const apply = (ctx: Context, config: Config) => {
  return provide(ctx, name, createNodePath(config));
};
