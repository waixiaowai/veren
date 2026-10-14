/**
 * Discovery 服务：把工作区单元清单以 Cordis 服务提供到上下文。
 *
 * The discovery service: exposes the workspace unit inventory as a Cordis
 * context service.
 *
 * 服务消费 Project 服务（项目根与 scan 配置），把纯扫描函数（./discovery.ts）
 * 包装为 list / find 两个只读方法；命令插件注入 Discovery 即可查询单元，
 * 无需感知文件系统细节。
 *
 * The service consumes the Project service (the project root and its scan
 * config) and wraps the pure scanning functions (./discovery.ts) behind two
 * read-only methods, list and find; command plugins inject Discovery to query
 * units without touching filesystem details.
 */

import { join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { Service } from '@deepseek-ai/cordis';
import type { FileSystem } from '@deepseek-ai/dsh-fs';
import type { ProjectInfo } from '@veren/commander-project';
import { discoverUnits, MAX_SCAN_DEPTH } from './discovery.js';
import type { Unit } from './discovery.js';
import { readDependencyUnit, readUnitDependencyNames } from './deps.js';

// Discovery 令牌定义在平台无关的 ./tokens.ts（浏览器等环境可单独导入），
// 这里本地使用并再导出以保持包 API 稳定。
// The Discovery token is defined in the platform-independent ./tokens.ts
// (importable alone in the browser, etc.); it is used here and re-exported to
// keep the package's API stable.
import { Discovery } from './tokens.js';
export { Discovery } from './tokens.js';

/** Discovery 归一化配置 / the discovery's normalized config */
export interface Config {
  /**
   * 扫描深度上限（相对每个 scan 根的目录层数）。
   * The scan depth cap (directory levels below each scan root).
   */
  maxDepth: number;
  /**
   * 在内置 SKIP_DIRS 之外追加跳过的目录名。
   * Directory names skipped in addition to the built-in SKIP_DIRS.
   */
  skip: string[];
}

/**
 * 插件配置 schema：maxDepth 限制扫描深度，skip 在内置跳过名单之外追加目录名。
 * 经 ctx.plugin 装载时自动校验并补全缺省值。
 *
 * The plugin config schema: maxDepth caps the scan depth, skip adds directory
 * names beyond the built-in skip list. Installing via ctx.plugin validates it
 * and fills defaults automatically.
 */
export const Config = z.object({
  maxDepth: z.number().min(0).default(MAX_SCAN_DEPTH),
  skip: z.array(z.string()).default([]),
});

/**
 * Discovery 服务：构造时即以 Discovery 令牌注册，并随装载它的 fiber 卸载
 * 自动注销。list 每次调用都重新扫描（CLI 进程生命周期短，缓存收益有限，
 * 换取永远新鲜的结果）。
 *
 * The discovery service: constructing registers it under the Discovery token,
 * and it unregisters automatically when its fiber unloads. list rescans on
 * every call (a CLI process is short-lived; freshness beats caching here).
 */
export class DiscoveryService extends Service {
  /** 项目根（单元 dir 的相对基准）/ the project root (what unit dirs are relative to) */
  get root(): string {
    return this._project.root;
  }

  constructor(
    ctx: Context,
    private readonly _project: ProjectInfo,
    private readonly _fs: FileSystem,
    /** 本实例的归一化配置 / the normalized config of this instance */
    readonly config: Config = { maxDepth: MAX_SCAN_DEPTH, skip: [] },
  ) {
    super(ctx, Discovery);
  }

  /** 全部单元，按 dir 排序（输出稳定）/ every unit sorted by dir (stable output) */
  list(): Promise<Unit[]> {
    return discoverUnits(this._fs, this._project.root, this._project.config, this.config);
  }

  /** 按名查找单元；未命中返回 undefined / find one unit by name; undefined on a miss */
  async find(name: string): Promise<Unit | undefined> {
    return (await this.list()).find((unit) => unit.name === name);
  }

  /**
   * 一个子包的依赖（dependencies）映射为单元列表：工作区命中的直接取清单，
   * 第三方依赖从其 node_modules 的 package.json 读 name/description（dir 指向
   * node_modules 内路径）；未知名或没有 package.json 时返回空数组。
   * Maps a sub-package's dependencies (dependencies) to a unit list: workspace
   * hits come straight from the inventory, third-party dependencies get their
   * name/description from the package.json in node_modules (dir points into
   * node_modules and is conventional, not guaranteed to exist); an empty array
   * on an unknown name or when package.json is absent.
   */
  async listDependencies(name: string): Promise<Unit[]> {
    const units = await this.list();
    const unit = units.find((candidate) => candidate.name === name);
    if (!unit) return [];
    // dir 是相对项目根路径，转回绝对路径读取清单 / dir is root-relative; convert back to read the manifest
    const unitDir = join(this._project.root, unit.dir);
    const depNames = await readUnitDependencyNames(this._fs, unitDir);
    // 名字 -> 单元索引，避免循环内反复线性查找 / name -> unit index; avoids repeated linear scans in the loop
    const byName = new Map(units.map((candidate) => [candidate.name, candidate]));
    const resolved: Unit[] = [];
    const seen = new Set<string>();
    for (const depName of depNames) {
      if (seen.has(depName)) continue;
      seen.add(depName);
      const hit = byName.get(depName);
      resolved.push(
        hit ?? await readDependencyUnit(this._fs, this._project.root, [unitDir, this._project.root], depName),
      );
    }
    return resolved;
  }
}
