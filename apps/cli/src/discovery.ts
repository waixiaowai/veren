/**
 * 工作区单元发现：按文件约定识别 npm 包与 Rust crate。
 *
 * Workspace unit discovery: npm packages and Rust crates by file convention.
 *
 * 设计约定 / Design notes:
 *   - 目录内含 package.json 视为 npm 单元，含 Cargo.toml 视为 Rust 单元；
 *     两者并存时以 package.json 为准（npm 入口优先）。
 *     A directory with package.json is an npm unit, one with Cargo.toml a Rust
 *     unit; if both exist, package.json wins (npm entry takes precedence).
 *   - dir 始终是相对项目根、以 / 分隔的路径，保证跨平台输出稳定、可被 AI 直接引用。
 *     dir is always a root-relative path with forward slashes, so output stays
 *     stable across platforms and directly quotable by AI agents.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { type Config } from './config.ts';

/**
 * 扫描深度上限（相对每个 scan 根的目录层数），防止误入深层生成物目录。
 * Scan depth cap (directory levels below each scan root) to avoid
 * descending into deep build-output directories.
 */
export const MAX_SCAN_DEPTH = 4;

/** 扫描时跳过的目录名 / directory names skipped while scanning */
export const SKIP_DIRS = new Set(['node_modules', 'dist', 'target', '.git']);

/** 一个工作区单元（npm 包或 Rust crate）/ one workspace unit (npm package or Rust crate) */
export interface Unit {
  /** 单元名：npm 为 package.json 的 name；Rust 为 [package] name / unit name */
  name: string;
  /** 英文描述：什么情况下使用（见 AGENTS.md 约定）/ English description: when to use it */
  description: string;
  /** 相对项目根的目录位置（/ 分隔）/ directory relative to the project root */
  dir: string;
}

/**
 * 扫描全部 scan 根，按目录序返回所有单元（稳定输出，便于 AI 比对 diff）。
 * Scan all scan roots and return every unit sorted by dir (stable output,
 * which makes AI-side diffs easy to compare).
 */
export function discoverUnits(root: string, config: Config): Unit[] {
  const units: Unit[] = [];
  for (const scanRoot of config.scanRoots) {
    walkDir(root, scanRoot, 0, units);
  }
  return units.sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));
}

/** 递归遍历一个 scan 根（有深度上限与跳过名单）/ recursively walk one scan root */
function walkDir(root: string, dir: string, depth: number, units: Unit[]): void {
  if (depth > MAX_SCAN_DEPTH) return;

  // 同一目录下 package.json 优先，Cargo.toml 兜底 / package.json first, Cargo.toml as fallback
  const unit = readNpmUnit(dir, root) ?? readCargoUnit(dir, root);
  if (unit) {
    units.push(unit);
    // 命中单元后不再向其子目录下钻：单元即最小分发边界。
    // Do not descend into a matched unit: a unit is the smallest distributable boundary.
    return;
  }

  for (const entry of readdirSafe(dir)) {
    // 跳过依赖/构建产物/隐藏目录 / skip deps, build outputs and hidden dirs
    if (entry.startsWith('.') || SKIP_DIRS.has(entry)) continue;
    walkDir(root, join(dir, entry), depth + 1, units);
  }
}

/** 读取目录项；目录不可读时返回空数组而非中断扫描 / list entries, or [] if unreadable */
function readdirSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** 从 package.json 读取 npm 单元；缺 name 视为非单元 / read an npm unit from package.json */
export function readNpmUnit(dir: string, root: string): Unit | null {
  const file = join(dir, 'package.json');
  if (!existsSync(file)) return null;
  const json = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
  if (typeof json.name !== 'string' || json.name === '') return null;
  return {
    name: json.name,
    description: typeof json.description === 'string' ? json.description : '',
    // Windows 反斜杠统一为 / ，输出跨平台稳定 / normalize separators for stable output
    dir: relative(root, dir).replace(/\\/g, '/'),
  };
}

/** 从 Cargo.toml 读取 Rust 单元；缺 [package] name 视为非单元 / read a Rust unit from Cargo.toml */
export function readCargoUnit(dir: string, root: string): Unit | null {
  const file = join(dir, 'Cargo.toml');
  if (!existsSync(file)) return null;
  const fields = parseCargoPackageFields(readFileSync(file, 'utf8'));
  if (!fields.name) return null;
  return {
    name: fields.name,
    description: fields.description ?? '',
    dir: relative(root, dir).replace(/\\/g, '/'),
  };
}

/**
 * 零依赖的 Cargo.toml [package] 段字段提取：只支持本仓库用到的
 * `name`/`description` 基础字符串写法（值内支持 \" 转义，行尾允许 # 注释）。
 * Dependency-free extraction of the [package] fields from Cargo.toml: only the
 * plain `name`/`description` string style used in this repo is supported
 * (\" escapes inside the value; a trailing # comment is tolerated).
 */
export function parseCargoPackageFields(text: string): { name?: string; description?: string } {
  const fields: { name?: string; description?: string } = {};
  let section = '';
  for (const line of text.split(/\r?\n/)) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (header) {
      section = header[1].trim();
      continue;
    }
    // 只关心 [package] 段 / only the [package] section matters here
    if (section !== 'package') continue;
    const field = line.match(/^\s*(name|description)\s*=\s*"((?:\\.|[^"\\])*)"\s*(?:#.*)?$/);
    if (field) {
      fields[field[1] as 'name' | 'description'] = field[2].replace(/\\(.)/g, '$1');
    }
  }
  return fields;
}
