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
 * 文件、路径与 YAML 解析能力全部来自注入的服务（一切皆插件）：
 * File, path and YAML parsing capabilities all come from injected services
 * ("everything is a plugin"):
 *   @veren/node-fs + @veren/node-path + @veren/yaml-parser。
 */

import type { Context } from '@deepseek-ai/cordis';
import { getOrThrow, provide } from '@veren/core';
import { name as FsToken } from '@veren/node-fs';
import { name as PathToken } from '@veren/node-path';
import { name as YamlParserToken } from '@veren/yaml-parser';
import { loadConfig } from './config.js';
import { findProjectRoot } from './root.js';
import { Project } from './tokens.js';
import type { Config, ProjectInfo } from './tokens.js';

export { DEFAULT_SCAN_ROOTS, loadConfig } from './config.js';
export { CONFIG_FILE, findProjectRoot } from './root.js';
export type { Config, ProjectInfo };
export { Project as name, Project };

/** 依赖的服务：YAML 解析、文件系统与路径 / requires the YAML parser, fs and path services */
export const inject = [YamlParserToken, FsToken, PathToken];

/**
 * 项目服务 Provider：定位项目根、加载配置，并以 Project 提供到上下文。
 * apply 为异步：服务在 await 之后可用。
 *
 * The project service provider: locates the root, loads the config and
 * provides both under Project. apply is async: the service is ready after the
 * await.
 */
export const apply = async (ctx: Context): Promise<() => unknown> => {
  const fs = getOrThrow(ctx, FsToken);
  const path = getOrThrow(ctx, PathToken);
  const parser = getOrThrow(ctx, YamlParserToken);
  const root = await findProjectRoot(fs, path);
  const config = await loadConfig(root, parser, fs, path);
  return provide(ctx, Project, { root, config } satisfies ProjectInfo);
};
