/**
 * @veren/cli —— veren 项目级元信息 CLI（面向 AI 与开发者）
 * @veren/cli — veren project-level metadata CLI (for AI agents and developers)
 *
 * 命令 / Commands:
 *   list                  列出工作区全部单元（npm 包 / Rust crate），JSON 输出
 *                         list all workspace units (npm packages / Rust crates) as JSON
 *                         输出 / output: [{ name, description, dir }]
 *   doc <name>            输出该单元 README.md 原文（缺失时回退 README.cn.md）
 *                         print the unit's README.md verbatim (falls back to README.cn.md)
 *   doc <name> --cn       输出 README.cn.md 原文（缺失时回退 README.md）
 *                         print README.cn.md verbatim (falls back to README.md)
 *   help                  显示帮助 / show help
 *
 * 配置 / Configuration:
 *   项目根目录的 .veren.yaml（scan 字段声明参与扫描的根目录，详见该文件内注释）。
 *   .veren.yaml at the project root (its scan field lists the scan roots; see
 *   the comments inside that file for details).
 *
 * 设计约定 / Design notes:
 *   - 单元发现基于文件约定：目录内含 package.json 视为 npm 单元，含 Cargo.toml
 *     视为 Rust 单元；两者并存时以 package.json 为准（npm 入口优先）。
 *     Units are discovered by convention: a directory with package.json is an
 *     npm unit, one with Cargo.toml is a Rust unit; if both exist, package.json
 *     wins (npm entry takes precedence).
 *   - dir 始终是相对项目根、以 / 分隔的路径，保证跨平台输出稳定、可被 AI 直接引用。
 *     dir is always a root-relative path with forward slashes, so output stays
 *     stable across platforms and directly quotable by AI agents.
 *
 * 运行方式 / How to run:
 *   `pnpm cli <command>`（根 package.json 的 cli 脚本代理到本文件）。
 *   `pnpm cli <command>` (the root "cli" script proxies to this file).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { parse as parseYaml } from 'yaml';

/* ============================================================
 * 常量 / Constants
 * ============================================================ */

/** 配置文件名（位于项目根）/ config file name (at the project root) */
const CONFIG_FILE = '.veren.yaml';

/** 配置缺失时的默认扫描根 / default scan roots when the config omits them */
const DEFAULT_SCAN_ROOTS = ['apps', 'packages', 'cargos'];

/**
 * 扫描深度上限（相对每个 scan 根的目录层数），防止误入深层生成物目录。
 * Scan depth cap (directory levels below each scan root) to avoid
 * descending into deep build-output directories.
 */
const MAX_SCAN_DEPTH = 4;

/** 扫描时跳过的目录名 / directory names skipped while scanning */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'target', '.git']);

/** 双语文档文件名（遵循 AGENTS.md 约定）/ bilingual doc file names (per AGENTS.md) */
const README_FILES = {
  en: 'README.md',
  cn: 'README.cn.md',
} as const;

/* ============================================================
 * 类型 / Types
 * ============================================================ */

/** 一个工作区单元（npm 包或 Rust crate）/ one workspace unit (npm package or Rust crate) */
interface Unit {
  /** 单元名：npm 为 package.json 的 name；Rust 为 [package] name / unit name */
  name: string;
  /** 英文描述：什么情况下使用（见 AGENTS.md 约定）/ English description: when to use it */
  description: string;
  /** 相对项目根的目录位置（/ 分隔）/ directory relative to the project root */
  dir: string;
}

/** 解析后的 CLI 配置 / parsed CLI configuration */
interface Config {
  /** 参与扫描的根目录（绝对路径）/ scan roots (absolute paths) */
  scanRoots: string[];
}

/** 带双语提示的 CLI 级错误 / CLI-level error with a bilingual message */
class CliError extends Error {}

/* ============================================================
 * 项目根定位与配置加载 / project root & config loading
 * ============================================================ */

/**
 * 从 startDir 逐级向上查找 .veren.yaml，其所在目录即项目根；找不到则报错。
 * Walk up from startDir until .veren.yaml is found; its directory is the
 * project root. Throws a CliError when not found.
 */
function findProjectRoot(startDir: string = process.cwd()): string {
  let dir = startDir;
  for (;;) {
    if (existsSync(join(dir, CONFIG_FILE))) return dir;
    const parent = dirname(dir);
    // 已到文件系统根仍未找到 / reached the filesystem root without a hit
    if (parent === dir) {
      throw new CliError(
        `未找到 ${CONFIG_FILE}，请确认在 veren 项目内运行 / ${CONFIG_FILE} not found; run inside the veren project (start: ${startDir})`,
      );
    }
    dir = parent;
  }
}

/**
 * 读取并解析 .veren.yaml；scan 缺省时回退到内置默认根，字段类型不合法则报错。
 * Read and parse .veren.yaml; fall back to the built-in default roots when
 * scan is omitted, and throw a CliError on invalid field types.
 */
function loadConfig(root: string): Config {
  const raw = readFileSync(join(root, CONFIG_FILE), 'utf8');
  // 空文件时 yaml 解析为 null，同样走默认值 / an empty file parses to null
  const parsed = (parseYaml(raw) ?? {}) as Record<string, unknown>;
  const scan = parsed.scan ?? DEFAULT_SCAN_ROOTS;
  if (!Array.isArray(scan) || scan.some((entry) => typeof entry !== 'string')) {
    throw new CliError(
      `${CONFIG_FILE} 的 scan 字段必须是字符串数组 / the "scan" field in ${CONFIG_FILE} must be a string array`,
    );
  }
  const scanRoots = (scan as string[]).map((entry) => join(root, entry));
  for (const scanRoot of scanRoots) {
    if (!existsSync(scanRoot)) {
      throw new CliError(
        `scan 根目录不存在 / scan root does not exist: ${scanRoot}`,
      );
    }
  }
  return { scanRoots };
}

/* ============================================================
 * 单元发现 / unit discovery
 * ============================================================ */

/**
 * 扫描全部 scan 根，按目录序返回所有单元（稳定输出，便于 AI 比对 diff）。
 * Scan all scan roots and return every unit sorted by dir (stable output,
 * which makes AI-side diffs easy to compare).
 */
function discoverUnits(root: string, config: Config): Unit[] {
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
function readNpmUnit(dir: string, root: string): Unit | null {
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
function readCargoUnit(dir: string, root: string): Unit | null {
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
function parseCargoPackageFields(text: string): { name?: string; description?: string } {
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

/* ============================================================
 * 命令实现 / command implementations
 * ============================================================ */

/** list：JSON 输出全部单元 / list: print every unit as JSON */
function cmdList(root: string, config: Config): void {
  const units = discoverUnits(root, config);
  // 独占 stdout：除 JSON 外不打印任何修饰内容，方便 AI 直接解析。
  // Own stdout exclusively: print nothing but the JSON so AI parsing stays trivial.
  process.stdout.write(`${JSON.stringify(units, null, 2)}\n`);
}

/**
 * doc：按名定位单元并原文输出其 README；优先语言可指定，缺失时回退另一语言。
 * doc: locate the unit by name and print its README verbatim; the preferred
 * language is selectable, falling back to the other language when missing.
 */
function cmdDoc(root: string, config: Config, name: string, preferCn: boolean): void {
  const unit = discoverUnits(root, config).find((entry) => entry.name === name);
  if (!unit) {
    const names = discoverUnits(root, config).map((entry) => entry.name).join(', ');
    throw new CliError(
      `未找到单元 "${name}"（可用：${names}）/ unit "${name}" not found (available: ${names})`,
    );
  }

  // 首选语言在前，另一语言兜底 / preferred language first, the other as fallback
  const candidates = preferCn ? [README_FILES.cn, README_FILES.en] : [README_FILES.en, README_FILES.cn];
  for (const file of candidates) {
    const path = join(root, unit.dir, file);
    if (existsSync(path)) {
      // 原样输出，不添加任何修饰 / verbatim output, no decorations
      process.stdout.write(readFileSync(path, 'utf8'));
      return;
    }
  }
  throw new CliError(
    `${unit.dir} 下没有任何 README（约定要求 ${README_FILES.en} 与 ${README_FILES.cn}，见 AGENTS.md）/ no README under ${unit.dir} (the convention requires ${README_FILES.en} and ${README_FILES.cn}, see AGENTS.md)`,
  );
}

/** help：双语用法说明 / help: bilingual usage text */
function printHelp(): void {
  process.stdout.write(`veren cli —— 项目级元信息查询 / project-level metadata CLI

用法 / usage:
  pnpm cli list               列出全部单元（JSON）/ list all units (JSON)
  pnpm cli doc <name>         输出 README.md 原文 / print README.md verbatim
  pnpm cli doc <name> --cn    输出 README.cn.md 原文 / print README.cn.md verbatim
  pnpm cli help               显示本帮助 / show this help

配置 / config: ${CONFIG_FILE}（项目根 / at the project root）
示例 / examples:
  pnpm cli list
  pnpm cli doc @veren/core
  pnpm cli doc veren-core --cn
`);
}

/* ============================================================
 * 入口 / entry
 * ============================================================ */

/** 解析 argv 并分发到对应命令 / parse argv and dispatch to a command */
function main(argv: string[]): void {
  const [command, ...rest] = argv;

  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  const root = findProjectRoot();
  const config = loadConfig(root);

  if (command === 'list') {
    cmdList(root, config);
    return;
  }

  if (command === 'doc') {
    // --cn / -c 可出现在任意位置；首个非标志参数即单元名。
    // --cn / -c may appear anywhere; the first non-flag argument is the unit name.
    const preferCn = rest.includes('--cn') || rest.includes('-c');
    const name = rest.find((arg) => arg !== '--cn' && arg !== '-c');
    if (name === undefined) {
      throw new CliError('用法 / usage: pnpm cli doc <name> [--cn]');
    }
    cmdDoc(root, config, name, preferCn);
    return;
  }

  throw new CliError(`未知命令 "${command}"，运行 pnpm cli help 查看用法 / unknown command "${command}"; run pnpm cli help for usage`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  // 统一错误出口：信息走 stderr，退出码非 0，供 AI 侧识别失败并自纠。
  // Single error exit: message on stderr, non-zero code, so AI callers can detect and self-correct.
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`cli: ${message}\n`);
  process.exitCode = 1;
}
