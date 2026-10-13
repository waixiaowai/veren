/**
 * @veren/commander-discovery —— 单元发现插件：标准 Cordis 插件模块。
 *
 * @veren/commander-discovery — the discovery plugin: a standard Cordis plugin
 * module.
 *
 * 遵循本仓库 Provider 约定（同 @veren/yaml-parser）：
 * Follows this repository's provider convention (same as @veren/yaml-parser):
 *   - name    服务令牌（兼作插件显示名）/ the service token (doubling as the
 *             plugin display name)
 *   - inject  依赖的服务令牌 / required service tokens
 *   - Config  用 @deepseek-ai/schemastery 定义的插件配置 schema / the plugin
 *             config schema defined with @deepseek-ai/schemastery
 *   - apply   装配函数：创建 Discovery 服务并提供到上下文 / wires the
 *             Discovery service into the context
 */

import type { Context } from '@deepseek-ai/cordis';
import { getOrThrow } from '@veren/core';
import { Project } from '@veren/commander-project';
import { name as FsToken } from '@veren/node-fs';
import { name as PathToken } from '@veren/node-path';
import { Config, DiscoveryService } from './service.js';
import { Discovery } from './tokens.js';

export type { ScanConfig, ScanOptions, Unit } from './discovery.js';
export {
  MAX_SCAN_DEPTH,
  SKIP_DIRS,
  discoverUnits,
  parseCargoPackageFields,
  readCargoUnit,
  readNpmUnit,
} from './discovery.js';
export { DiscoveryService } from './service.js';
// Config 值导出同时携带同名接口的类型含义，供消费方在类型位置使用。
// The Config value export also carries the same-named interface's type
// meaning, so consumers can use it in type positions.
export { Config } from './service.js';
// 令牌与最小结构视图定义在平台无关的 ./tokens.ts；平台无关消费方（如浏览器）
// 也可以从 `@veren/commander-discovery/tokens` 子路径单独导入，避免拖入 Cordis。
// The tokens and their minimal structural views live in the platform-
// independent ./tokens.ts; platform-agnostic consumers (such as the browser)
// may import them alone from the `@veren/commander-discovery/tokens` subpath,
// keeping Cordis out of their bundles.
export { Discovery } from './tokens.js';
export type { UnitInventory } from './tokens.js';

/** 服务令牌：同时作为插件显示名 / the service token, doubling as the plugin display name */
export { Discovery as name };

/** 依赖的服务：Project（项目根与 scan 配置）、文件系统与路径 / requires Project (root + scan config), fs and path services */
export const inject = [Project, FsToken, PathToken];

/**
 * 插件装配：从上下文读取 Project 服务，创建 Discovery 服务。Service 构造时
 * 即以 Discovery 令牌把自己注册到上下文，并随本插件 fiber 卸载自动注销
 * （不要返回实例 —— 插件返回值会被当作 effect disposer）。
 * Plugin assembly: reads the Project service from the context and creates the
 * Discovery service. The Service registers itself under the Discovery token on
 * construction and unregisters automatically when this plugin's fiber unloads
 * (never return the instance — a plugin's return value is treated as an
 * effect disposer).
 */
export const apply = (ctx: Context, config: Config) => {
  new DiscoveryService(ctx, getOrThrow(ctx, Project), getOrThrow(ctx, FsToken), getOrThrow(ctx, PathToken), config);
};
