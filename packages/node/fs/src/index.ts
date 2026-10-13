/**
 * @veren/node-fs —— Node 文件系统 Provider：把 fs/promises 以 Cordis 服务
 * 提供到上下文。
 * @veren/node-fs — the Node filesystem provider: exposes fs/promises as a
 * Cordis context service.
 *
 * 遵循本仓库 Provider 约定（同 @veren/yaml-parser）：
 * Follows this repository's provider convention (same as @veren/yaml-parser):
 *   - name    服务令牌 / the service token
 *   - inject  依赖的服务令牌 / required service tokens
 *   - Config  用 @deepseek-ai/schemastery 定义的插件配置 schema / the plugin
 *             config schema defined with @deepseek-ai/schemastery
 *   - apply   装配函数：创建文件系统服务并提供到上下文 / wires the fs service
 */

import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { provide } from '@veren/core';
import { createNodeFs } from './service.js';
import type { NodeFs } from './tokens.js';
import { verenNodeFs as name } from './tokens.js';
export type { NodeFs };
export { name };

/** 无依赖的服务：不依赖任何其他服务，可最先激活 / dependency-free service, activatable first */
export const inject = [];

/**
 * 插件配置 schema：只声明文本默认编码。
 * The plugin config schema: only the default text encoding is declared.
 */
export const Config = z.object({
  /** 读写文本的默认编码 / the default encoding for reading and writing text */
  encoding: z
    .union([z.const('utf8'), z.const('utf16le'), z.const('latin1'), z.const('ascii')])
    .default('utf8'),
});

/** 归一化后的插件配置 / the normalized plugin config */
export interface Config {
  /** 读写文本的默认编码 / the default encoding for reading and writing text */
  encoding: 'utf8' | 'utf16le' | 'latin1' | 'ascii';
}

/**
 * 创建文件系统服务并以 name 提供到上下文；返回取消提供的 disposer。
 * config 应先经 Config schema 归一化（ctx.plugin 加载时自动完成）。
 *
 * Creates the filesystem service, provides it under name, and returns the
 * unregistering disposer. The config must be normalized through the Config
 * schema first (automatic via ctx.plugin).
 */
export const apply = (ctx: Context, config: Config) => {
  return provide(ctx, name, createNodeFs(config));
};
