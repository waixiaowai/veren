/**
 * 项目根定位：从起始目录逐级向上查找 .veren.yaml。
 * Project root discovery: walks up from a start directory looking for
 * .veren.yaml.
 *
 * 文件能力复用 @deepseek-ai/dsh-fs 的 ctx.fs 服务（一切皆插件）；
 * 路径拼接为纯函数，直接使用 node:path。
 * File capabilities reuse the ctx.fs service from @deepseek-ai/dsh-fs
 * ("everything is a plugin"); path joining is a pure function, so node:path
 * is used directly.
 */

import { dirname, join } from 'node:path';
import type { FileSystem } from '@deepseek-ai/dsh-fs';
import { CliError } from '@veren/commander-core';

/** 配置文件名（位于项目根）/ config file name (at the project root) */
export const CONFIG_FILE = '.veren.yaml';

/**
 * 从 startDir 逐级向上查找 .veren.yaml，其所在目录即项目根；找不到则报错。
 * fs 为注入的 ctx.fs 文件系统服务。
 *
 * Walks up from startDir until .veren.yaml is found; its directory is the
 * project root. Throws a CliError when not found. fs is the injected ctx.fs
 * filesystem service.
 */
export async function findProjectRoot(fs: FileSystem, startDir: string = process.cwd()): Promise<string> {
  let dir = startDir;
  for (; ;) {
    if (await pathExists(fs, join(dir, CONFIG_FILE))) return dir;
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

/** 路径存在性：lstat 非空即存在，不抛错 / path existence: a defined lstat means present, never throws */
export async function pathExists(fs: FileSystem, path: string): Promise<boolean> {
  return (await fs.lstat(path)) !== undefined;
}
