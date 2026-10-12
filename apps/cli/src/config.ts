/**
 * 项目根定位与 .veren.yaml 配置加载。
 *
 * Project root discovery and .veren.yaml config loading.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parse as parseYaml } from 'yaml';

/** 配置文件名（位于项目根）/ config file name (at the project root) */
export const CONFIG_FILE = '.veren.yaml';

/** 配置缺失时的默认扫描根 / default scan roots when the config omits them */
export const DEFAULT_SCAN_ROOTS = ['apps', 'packages', 'cargos'];

/** 解析后的 CLI 配置 / parsed CLI configuration */
export interface Config {
  /** 参与扫描的根目录（绝对路径）/ scan roots (absolute paths) */
  scanRoots: string[];
}

/** 带双语提示的 CLI 级错误 / CLI-level error with a bilingual message */
export class CliError extends Error {}

/**
 * 从 startDir 逐级向上查找 .veren.yaml，其所在目录即项目根；找不到则报错。
 * Walk up from startDir until .veren.yaml is found; its directory is the
 * project root. Throws a CliError when not found.
 */
export function findProjectRoot(startDir: string = process.cwd()): string {
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
export function loadConfig(root: string): Config {
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
