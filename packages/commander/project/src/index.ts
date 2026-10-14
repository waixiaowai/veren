/**
 * @veren/commander-project —— 项目服务 Provider：定位项目根、加载 .veren.yaml
 * 配置，并把 `{ root, config }` 以 Project 服务提供到上下文。
 * @veren/commander-project — the project service provider: locates the project
 * root, loads the .veren.yaml config, and provides `{ root, config }` under
 * the Project token.
 *
 * 遵循本仓库 Provider 约定（同 @veren/yaml-parser）：
 * Follows this repository's provider convention (same as @veren/yaml-parser):
 *   - name    服务令牌 / the service token
 *   - inject  依赖的服务令牌 / required service tokens
 *   - Config  用 @deepseek-ai/schemastery 定义的插件配置 schema / the plugin
 *             config schema defined with @deepseek-ai/schemastery
 *   - apply   装配函数：定位根、加载配置并提供服务 / locates the root, loads
 *             the config and provides the service
 *
 * 文件能力复用 @deepseek-ai/dsh-fs 的 ctx.fs 服务，YAML 解析来自
 * @veren/yaml-parser（一切皆插件）：
 * File capabilities reuse the ctx.fs service from @deepseek-ai/dsh-fs and YAML
 * parsing comes from @veren/yaml-parser ("everything is a plugin").
 */

import type { Context } from '@deepseek-ai/cordis';
import { getOrThrow, provideValue } from '@veren/core';
import { Fs } from '@veren/commander-core';
import { name as YamlParserToken } from '@veren/yaml-parser';
import { DEFAULT_SCAN_ROOTS, loadConfig } from './config.js';
import { CONFIG_FILE, findProjectRoot } from './root.js';
import { Project } from './tokens.js';
import type { Config, ProjectInfo } from './tokens.js';

export { DEFAULT_SCAN_ROOTS, loadConfig } from './config.js';
export { CONFIG_FILE, findProjectRoot, pathExists } from './root.js';
export type { Config, ProjectInfo };
export { Project as name, Project };

/** 依赖的服务：YAML 解析与 dsh-fs 的 ctx.fs / requires the YAML parser and the dsh-fs ctx.fs services */
export const inject = [YamlParserToken, Fs];

/**
 * 项目服务 Provider：定位项目根、加载配置，并以 Project 提供到上下文。
 * apply 为异步：服务在 await 之后可用。
 *
 * The project service provider: locates the root, loads the config and
 * provides both under Project. apply is async: the service is ready after the
 * await.
 */
export const apply = async (ctx: Context): Promise<() => unknown> => {
  const fs = getOrThrow(ctx, Fs);
  const parser = getOrThrow(ctx, YamlParserToken);
  const root = await findProjectRoot(fs);
  const config = await loadConfig(root, parser, fs);
  return provideValue(ctx, Project, { root, config } satisfies ProjectInfo);
};
