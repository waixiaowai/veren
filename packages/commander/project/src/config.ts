/**
 * .veren.yaml 配置加载：读取文本并经 YAML 解析服务解析。
 * .veren.yaml config loading: reads the text and parses it through the YAML
 * parser service.
 *
 * 文件能力复用 @deepseek-ai/dsh-fs 的 ctx.fs 服务；YAML 解析由
 * @veren/yaml-parser 的服务注入；路径拼接直接使用 node:path。
 * File capabilities reuse the ctx.fs service from @deepseek-ai/dsh-fs; YAML
 * parsing is injected from @veren/yaml-parser; path joining uses node:path.
 */

import { join } from 'node:path';
import type { FileSystem } from '@deepseek-ai/dsh-fs';
import { CliError } from '@veren/commander-core';
import type { YamlParser } from '@veren/yaml-parser';
import { CONFIG_FILE, pathExists } from './root.js';
import type { Config } from './tokens.js';

/** 配置缺失时的默认扫描根 / default scan roots when the config omits them */
export const DEFAULT_SCAN_ROOTS = ['apps', 'packages', 'cargos'];

/**
 * 读取并解析 .veren.yaml；scan 缺省时回退到内置默认根，字段类型不合法则报错。
 * Read and parse .veren.yaml; fall back to the built-in default roots when
 * scan is omitted, and throw a CliError on invalid field types.
 */
export async function loadConfig(root: string, parser: YamlParser, fs: FileSystem): Promise<Config> {
  // resolve 产出稳定目标后整体读取 UTF-8 文本 / resolve to a stable target, then read the whole UTF-8 text
  const raw = await fs.readText(await fs.resolve(join(root, CONFIG_FILE)));
  // 空文件时 yaml 解析为 null，同样走默认值 / an empty file parses to null
  const parsed = (parser.parse(raw) ?? {}) as Record<string, unknown>;
  const scan = parsed.scan ?? DEFAULT_SCAN_ROOTS;
  assertStringArray(scan);
  const scanRoots = (scan as string[]).map((entry) => join(root, entry));
  for (const scanRoot of scanRoots) {
    if (!(await pathExists(fs, scanRoot))) {
      throw new CliError(`scan 根目录不存在 / scan root does not exist: ${scanRoot}`);
    }
  }
  return { scanRoots };
}

/** scan 字段必须是字符串数组 / the scan field must be a string array */
function assertStringArray(scan: unknown): void {
  if (!Array.isArray(scan) || scan.some((entry) => typeof entry !== 'string')) {
    throw new CliError(
      `${CONFIG_FILE} 的 scan 字段必须是字符串数组 / the "scan" field in ${CONFIG_FILE} must be a string array`,
    );
  }
}
