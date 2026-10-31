/**
 * 训练场的删除：显式授权、未托管目录保护与当前 DSH_HOME 保护。
 *
 * Removing a training ground: explicit authorization, unmanaged-directory
 * protection and active-DSH_HOME protection.
 */

import { rm } from 'node:fs/promises';
import { CliError } from '@veren/commander-core';
import { isDirectory, normalizePath } from './ground-fs.js';
import { readMeta } from './ground-meta.js';
import { resolveTrainingDir } from './ground-paths.js';
import type { RemoveTrainingGroundOptions, RemoveTrainingGroundResult } from './ground-types.js';

/** 删除训练场；必须显式授权，且默认拒绝未托管目录 / remove a ground; explicit authorization is required and unmanaged directories are refused by default */
export async function removeTrainingGround(
  options: RemoveTrainingGroundOptions,
): Promise<RemoveTrainingGroundResult> {
  const path = resolveTrainingDir(options.root, options.name);
  if (!(await isDirectory(path))) {
    throw new CliError(`训练场不存在 / training ground not found: ${options.name}`, {
      code: 'TRAINING_NOT_FOUND',
      details: { name: options.name, path },
    });
  }
  assertNotCurrentHome(path, options.currentHome);
  const meta = await readMeta(path);
  if (meta === null && !options.force) {
    throw new CliError(
      `目录不是本命令创建的训练场；确认后用 --force 删除 / the directory is not a managed training ground; use --force after confirming: ${path}`,
      { code: 'TRAINING_UNMANAGED', details: { name: options.name, path } },
    );
  }
  if (options.dryRun) return { name: options.name, path, removed: false };
  if (!options.yes) {
    throw new CliError(
      `删除训练场需要用户授权，请加 --yes / removing a training ground requires explicit user authorization; pass --yes: ${path}`,
      { code: 'TRAINING_AUTHORIZATION_REQUIRED', details: { name: options.name, path } },
    );
  }
  await rm(path, { recursive: true, force: false, maxRetries: 3 });
  return { name: options.name, path, removed: true };
}

/** 禁止删除当前运行中的 DSH_HOME / forbid removing the DSH_HOME this process runs in */
function assertNotCurrentHome(path: string, currentHome: string | undefined): void {
  if (currentHome !== undefined && normalizePath(path) === normalizePath(currentHome)) {
    throw new CliError(
      `不能删除当前运行的 DSH_HOME / refusing to remove the active DSH_HOME: ${path}`,
      { code: 'TRAINING_IN_USE', details: { path, currentHome } },
    );
  }
}
