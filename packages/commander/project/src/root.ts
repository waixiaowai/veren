/**
 * 项目根定位：从起始目录逐级向上查找 .veren.yaml。
 * Project root discovery: walks up from a start directory looking for
 * .veren.yaml.
 *
 * 文件与路径能力不在此处实现：全部通过 @veren/node-fs 与 @veren/node-path
 * 提供的服务注入（一切皆插件）。
 * File and path capabilities are not implemented here: they are injected as
 * services provided by @veren/node-fs and @veren/node-path ("everything is a
 * plugin").
 */

import type { NodeFs } from '@veren/node-fs';
import type { NodePath } from '@veren/node-path';
import { CliError } from '@veren/commander-core';

/** 配置文件名（位于项目根）/ config file name (at the project root) */
export const CONFIG_FILE = '.veren.yaml';

/**
 * 从 startDir 逐级向上查找 .veren.yaml，其所在目录即项目根；找不到则报错。
 * fs 与 path 为注入的文件系统/路径服务。
 *
 * Walks up from startDir until .veren.yaml is found; its directory is the
 * project root. Throws a CliError when not found. fs and path are the
 * injected filesystem/path services.
 */
export async function findProjectRoot(
  fs: NodeFs,
  path: NodePath,
  startDir: string = process.cwd(),
): Promise<string> {
  let dir = startDir;
  for (; ;) {
    if (await fs.exists(path.join(dir, CONFIG_FILE))) return dir;
    const parent = path.dirname(dir);
    // 已到文件系统根仍未找到 / reached the filesystem root without a hit
    if (parent === dir) {
      throw new CliError(
        `未找到 ${CONFIG_FILE}，请确认在 veren 项目内运行 / ${CONFIG_FILE} not found; run inside the veren project (start: ${startDir})`,
      );
    }
    dir = parent;
  }
}
