/**
 * @veren/commander-doc —— doc 命令插件：标准 Cordis 插件模块。
 *
 * @veren/commander-doc — the doc command plugin: a standard Cordis plugin
 * module.
 *
 * 遵循本仓库 Provider 约定（同 @veren/yaml-parser）：
 * Follows this repository's provider convention (same as @veren/yaml-parser):
 *   - name    插件显示名 / the plugin display name
 *   - inject  依赖的服务令牌 / required service tokens
 *   - Config  用 @deepseek-ai/schemastery 定义的插件配置 schema / the plugin
 *             config schema defined with @deepseek-ai/schemastery
 *   - apply   装配函数：向命令注册表注册 doc 命令 / registers the doc command
 *             with the command registry
 */

import type { Context } from '@deepseek-ai/cordis';
import { getOrThrow } from '@veren/core';
import { Commands } from '@veren/commander-core';
import { Discovery } from '@veren/commander-discovery';
import { name as FsToken } from '@veren/node-fs';
import { name as PathToken } from '@veren/node-path';
import { Config } from './doc.js';
import { cmdDoc } from './doc.js';

export type { UnitSource } from './doc.js';
// Config 值导出同时携带同名接口的类型含义，供消费方在类型位置使用。
// The Config value export also carries the same-named interface's type
// meaning, so consumers can use it in type positions.
export { cmdDoc, Config, DEFAULT_CN_FLAGS, locateUnit } from './doc.js';
// 令牌定义在平台无关的 ./tokens.ts；平台无关消费方（如浏览器）也可以从
// `@veren/commander-doc/tokens` 子路径单独导入，避免拖入 Cordis。
// The tokens live in the platform-independent ./tokens.ts; platform-agnostic
// consumers (such as the browser) may import them alone from the
// `@veren/commander-doc/tokens` subpath, keeping Cordis out of their bundles.
export { CN_FLAGS } from './tokens.js';

/** 插件显示名 / the plugin display name */
export const name = 'verenCliDocCommand';

/** 依赖的服务：命令注册表、Discovery、文件系统与路径 / requires the registry, Discovery, fs and path services */
export const inject = [Commands, Discovery, FsToken, PathToken];

/**
 * 插件装配：从上下文读取 Discovery、文件系统、路径服务与命令注册表，注册
 * doc 命令，并把注册 disposer 交还 fiber —— 插件卸载时命令自动注销。
 * Plugin assembly: reads the Discovery, fs and path services plus the command
 * registry from the context, registers the doc command, and hands the
 * registration disposer back to the fiber — the command disappears when the
 * plugin unloads.
 */
export const apply = (ctx: Context, config: Config) => {
  const source = getOrThrow(ctx, Discovery);
  const fs = getOrThrow(ctx, FsToken);
  const path = getOrThrow(ctx, PathToken);
  return getOrThrow(ctx, Commands).register({
    name: 'doc',
    usage: 'doc <name> [--cn]',
    summary: '输出 README 原文（--cn 中文优先）/ print a README verbatim (--cn prefers Chinese)',
    run: (args) => cmdDoc(source, config, args, fs, path),
  });
};
