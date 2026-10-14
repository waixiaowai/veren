/**
 * 子包依赖提取（纯读取）：只读子包自身 package.json 的 dependencies。
 *
 * Sub-package dependency extraction (pure reads): reads only the
 * sub-package's own package.json dependencies.
 *
 * 设计约定 / Design notes:
 *   - 只返回依赖名（dependencies 的键），不做版本解析；与工作区单元的交集
 *     由服务层完成。
 *     Only dependency names are returned (the keys of dependencies), no
 *     version parsing; intersecting with workspace units is the service
 *     layer's job.
 *   - 没有 package.json 时返回空数组；清单损坏时抛出，由调用方决定处理。
 *     Returns an empty array when package.json is absent; throws on a
 *     corrupted manifest, callers decide how to handle it.
 */

import { join, relative } from 'node:path';
import type { FileSystem } from '@deepseek-ai/dsh-fs';

/** 依赖单元与工作区单元同构 / a dependency shaped like a workspace unit */
export interface DependencyUnit {
  /** 依赖名 / the dependency name */
  name: string;
  /** 英文描述：来自依赖自身 package.json / English description from the dependency's own package.json */
  description: string;
  /** 相对项目根的目录位置（以 / 分割）/ directory relative to the project root */
  dir: string;
}

/** 路径存在性：lstat 非空即存在 / path existence: a defined lstat means present */
async function exists(fs: FileSystem, path: string): Promise<boolean> {
  return (await fs.lstat(path)) !== undefined;
}

/** 整体读取 UTF-8 文本 / read the whole UTF-8 text */
async function readText(fs: FileSystem, path: string): Promise<string> {
  return fs.readText(await fs.resolve(path));
}

/**
 * 从 package.json 原文提取 dependencies 的依赖名（保持清单内顺序，去重）。
 * Extracts the dependency names of dependencies from a package.json (manifest
 * order kept, deduplicated).
 */
export function parseNpmDependencyNames(manifest: string): string[] {
  const json = JSON.parse(manifest) as Record<string, unknown>;
  const deps = json.dependencies;
  if (deps === null || typeof deps !== 'object') return [];
  return Object.keys(deps as Record<string, unknown>);
}

/**
 * 读取一个子包目录（绝对路径）的依赖名：无 package.json 时返回空数组，
 * 清单损坏时抛出解析错误。
 * Reads one sub-package directory's (absolute path) dependency names: an
 * empty array when package.json is absent, a parse error on a corrupted
 * manifest.
 */
export async function readUnitDependencyNames(fs: FileSystem, dir: string): Promise<string[]> {
  const file = join(dir, 'package.json');
  if (!(await exists(fs, file))) return [];
  return parseNpmDependencyNames(await readText(fs, file));
}

/**
 * 读取一个第三方依赖的单元信息：依次在给定基准目录（先子包自身、再项目根）
 * 的 node_modules 下找 <dep>/package.json，取 name/description；两处都没有
 * 元数据时以空 description 兜底，保证依赖始终出现在结果里。
 * Reads one third-party dependency's unit info: looks for <dep>/package.json
 * under each base directory's node_modules (the sub-package itself first, then
 * the project root) and takes name/description; when no metadata is found the
 * description falls back to empty so the dependency always shows up.
 */
export async function readDependencyUnit(fs: FileSystem, root: string, baseDirs: readonly string[], depName: string): Promise<DependencyUnit> {
  for (const base of baseDirs) {
    const dir = join(base, 'node_modules', depName);
    const file = join(dir, 'package.json');
    if (!(await exists(fs, file))) continue;
    try {
      const json = JSON.parse(await readText(fs, file)) as Record<string, unknown>;
      return {
        name: typeof json.name === 'string' && json.name !== '' ? json.name : depName,
        description: typeof json.description === 'string' ? json.description : '',
        dir: relative(root, dir).replace(/\\/g, '/'),
      };
    } catch {
      // 元数据损坏：继续找下一个基准，最后兜底返回 / corrupted metadata: try the next base, fall through to the fallback
    }
  }
  return { name: depName, description: '', dir: `node_modules/${depName}` };
}
