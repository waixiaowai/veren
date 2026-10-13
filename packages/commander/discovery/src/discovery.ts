/**
 * 工作区单元发现（纯扫描）：按文件约定识别 npm 包与 Rust crate。
 * Workspace unit discovery (pure scanning): npm packages and Rust crates by
 * file convention.
 *
 * 设计约定 / Design notes:
 *   - 目录内含 package.json 视为 npm 单元，含 Cargo.toml 视为 Rust 单元；
 *     两者并存时以 package.json 为准（npm 入口优先）。
 *     A directory with package.json is an npm unit, one with Cargo.toml a Rust
 *     unit; if both exist, package.json wins (npm entry takes precedence).
 *   - dir 始终是相对项目根、以 / 分割的路径，保证跨平台输出稳定、可被 AI 直接引用。
 *     dir is always a root-relative path with forward slashes, so output stays
 *     stable across platforms and directly quotable by AI agents.
 *   - 清单存在但无法解析时向 stderr 告警并跳过，单个坏文件不中断整个扫描。
 *     A manifest that exists but cannot be parsed is warned about on stderr and
 *     skipped; one bad file never aborts the whole scan.
 *   - 文件能力复用 @deepseek-ai/dsh-fs 的 ctx.fs 服务（一切皆插件）；
 *     路径拼接为纯函数，直接使用 node:path。
 *     File capabilities reuse the ctx.fs service from @deepseek-ai/dsh-fs
 *     ("everything is a plugin"); path joining is a pure function, so
 *     node:path is used directly.
 */

import { join, relative } from 'node:path';
import type { FileSystem } from '@deepseek-ai/dsh-fs';

/**
 * 扫描深度上限缺省值（相对每个 scan 根的目录层数），防止误入深层生成物目录。
 * The default scan depth cap (directory levels below each scan root) to avoid
 * descending into deep build-output directories.
 */
export const MAX_SCAN_DEPTH = 4;

/** 内置跳过的目录名（始终生效）/ directory names always skipped (built in) */
export const SKIP_DIRS = new Set(['node_modules', 'dist', 'target', '.git']);

/** 扫描配置的最小形状：只要求 scanRoots（结构化兼容 ProjectInfo.config） / the minimal scan shape: only scanRoots (structurally compatible with ProjectInfo.config) */
export interface ScanConfig {
  /** 参与扫描的根目录（绝对路径）/ scan roots (absolute paths) */
  scanRoots: string[];
}

/** 可选扫描选项：深度上限与追加跳过名单 / optional scan options: depth cap and extra skip names */
export interface ScanOptions {
  /** 深度上限；缺省 MAX_SCAN_DEPTH / the depth cap; defaults to MAX_SCAN_DEPTH */
  maxDepth?: number;
  /**
   * 在内置 SKIP_DIRS 之外追加跳过的目录名（按目录名匹配）。
   * Directory names skipped in addition to the built-in SKIP_DIRS (matched by
   * directory name).
   */
  skip?: Iterable<string>;
}

/** 一次扫描生效的完整选项 / the effective options of one scan */
interface EffectiveOptions {
  maxDepth: number;
  skip: Set<string>;
}

/** 一个工作区单元（npm 包或 Rust crate）/ one workspace unit (npm package or Rust crate) */
export interface Unit {
  /** 单元名：npm 为 package.json 的 name；Rust 为 [package] name / unit name */
  name: string;
  /** 英文描述：什么情况下使用（见 AGENTS.md 约定）/ English description: when to use it */
  description: string;
  /** 相对项目根的目录位置（以 / 分割）/ directory relative to the project root */
  dir: string;
}

/**
 * 扫描全部 scan 根，按目录序返回所有单元（稳定输出，便于 AI 比对 diff）。
 * fs 为注入的 ctx.fs 文件系统服务。
 * Scan all scan roots and return every unit sorted by dir (stable output,
 * which makes AI-side diffs easy to compare). fs is the injected ctx.fs
 * filesystem service.
 */
export async function discoverUnits(
  fs: FileSystem,
  root: string,
  config: ScanConfig,
  options: ScanOptions = {},
): Promise<Unit[]> {
  const effective: EffectiveOptions = {
    maxDepth: options.maxDepth ?? MAX_SCAN_DEPTH,
    skip: new Set([...SKIP_DIRS, ...(options.skip ?? [])]),
  };
  const units: Unit[] = [];
  for (const scanRoot of config.scanRoots) {
    await walkDir(fs, root, scanRoot, 0, units, effective);
  }
  return units.sort((a, b) => (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));
}

/** 递归遍历一个 scan 根（有深度上限与跳过名单）/ recursively walk one scan root */
async function walkDir(
  fs: FileSystem,
  root: string,
  dir: string,
  depth: number,
  units: Unit[],
  options: EffectiveOptions,
): Promise<void> {
  if (depth > options.maxDepth) return;

  // 同一目录中 package.json 优先，Cargo.toml 兜底 / package.json first, Cargo.toml as fallback
  const unit = (await readNpmUnit(fs, dir, root)) ?? (await readCargoUnit(fs, dir, root));
  if (unit) {
    units.push(unit);
    // 命中单元后不再向其子目录下钻：单元即最小分发边界。
    // Do not descend into a matched unit: a unit is the smallest distributable boundary.
    return;
  }

  for (const entry of await readdirSafe(fs, dir)) {
    // 跳过依赖/构建产物/隐藏目录 / skip deps, build outputs and hidden dirs
    if (entry.startsWith('.') || options.skip.has(entry)) continue;
    await walkDir(fs, root, join(dir, entry), depth + 1, units, options);
  }
}

/** 读取目录项；目录不可读时返回空数组而不中断扫描 / list entries, or [] if unreadable */
async function readdirSafe(fs: FileSystem, dir: string): Promise<string[]> {
  try {
    // listDir 返回稳定排序的直接子项 / listDir returns stably sorted direct children
    const entries = await fs.listDir(await fs.resolve(dir));
    return entries.map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * 清单存在但无法解析时向 stderr 告警；stdout 保持纯净，供 AI 直接解析 JSON。
 * Warns on stderr when a manifest exists but cannot be parsed; stdout stays
 * clean so AI agents can parse the JSON directly.
 */
function warnUnreadableManifest(file: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`warning: 跳过无法解析的清单 / skipping unparseable manifest: ${file} (${message})\n`);
}

/** 路径存在性：lstat 非空即存在 / path existence: a defined lstat means present */
async function exists(fs: FileSystem, path: string): Promise<boolean> {
  return (await fs.lstat(path)) !== undefined;
}

/** 整体读取 UTF-8 文本 / read the whole UTF-8 text */
async function readText(fs: FileSystem, path: string): Promise<string> {
  return fs.readText(await fs.resolve(path));
}

/** 从 package.json 读取 npm 单元；缺 name 或清单损坏时视为非单元 / read an npm unit from package.json */
export async function readNpmUnit(fs: FileSystem, dir: string, root: string): Promise<Unit | null> {
  const file = join(dir, 'package.json');
  if (!(await exists(fs, file))) return null;
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(await readText(fs, file)) as Record<string, unknown>;
  } catch (error) {
    // 清单损坏：告警并跳过该目录，不让单个坏文件中断整个扫描。
    // Corrupted manifest: warn and skip so one bad file cannot abort the whole scan.
    warnUnreadableManifest(file, error);
    return null;
  }
  if (typeof json.name !== 'string' || json.name === '') return null;
  return {
    name: json.name,
    description: typeof json.description === 'string' ? json.description : '',
    // Windows 反斜杠统一成 /，输出跨平台稳定 / normalize separators for stable output
    dir: relative(root, dir).replace(/\\/g, '/'),
  };
}

/** 从 Cargo.toml 读取 Rust 单元；缺 [package] name 视为非单元 / read a Rust unit from Cargo.toml */
export async function readCargoUnit(fs: FileSystem, dir: string, root: string): Promise<Unit | null> {
  const file = join(dir, 'Cargo.toml');
  if (!(await exists(fs, file))) return null;
  const fields = parseCargoPackageFields(await readText(fs, file));
  if (!fields.name) return null;
  return {
    name: fields.name,
    description: fields.description ?? '',
    dir: relative(root, dir).replace(/\\/g, '/'),
  };
}

/**
 * 零依赖的 Cargo.toml [package] 段字段提取：只支持本仓库用到的
 * `name`/`description` 字符串写法——双引号基础串（处理 \" 转义）与单引号
 * 字面量串（原样保留，不处理转义），行尾允许 # 注释；不引入 TOML 依赖。
 * Dependency-free extraction of the [package] fields from Cargo.toml: only the
 * `name`/`description` string styles used in this repo are supported — a
 * double-quoted basic string (" escapes processed) and a single-quoted literal
 * string (kept verbatim, no escape processing); a trailing # comment is
 * tolerated. No TOML dependency.
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
    // 第一个捕获组为键；双引号值落入第 2 组，单引号值落入第 3 组。
    // The first group is the key; a double-quoted value lands in group 2 and a
    // single-quoted one in group 3.
    const field = line.match(/^\s*(name|description)\s*=\s*(?:"((?:\\.|[^"\\])*)"|'([^']*)')\s*(?:#.*)?$/);
    if (field) {
      fields[field[1] as 'name' | 'description'] = cargoStringValue(field[2], field[3]);
    }
  }
  return fields;
}

/** 双引号基础串处理转义；单引号字面量串原样返回 / unescape a basic string; return a literal string verbatim */
function cargoStringValue(basic: string | undefined, literal: string | undefined): string {
  return basic !== undefined ? basic.replace(/\\(.)/g, '$1') : literal ?? '';
}
