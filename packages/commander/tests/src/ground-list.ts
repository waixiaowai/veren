/**
 * 训练场的发现与只读检视：list / read / 摘要。
 *
 * Training-ground discovery and read-only inspection: list, read and summary.
 *
 * 列出根下全部训练场（含未托管目录）、按名读取单个训练场，并为每条目生成
 * 托管状态摘要（元数据、密钥与 profile 是否就位）。
 *
 * Lists every ground under the root (unmanaged directories included), reads a
 * single ground by name, and builds a managed-state summary per entry
 * (metadata, credentials and profile presence).
 */

import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { CliError } from '@veren/commander-core';
import { isDirectory, pathExists } from './ground-fs.js';
import { readMeta } from './ground-meta.js';
import { resolveTrainingDir } from './ground-paths.js';
import { CREDENTIALS_FILENAME, DEFAULT_PROFILE } from './ground-types.js';
import type { TrainingGroundMeta, TrainingGroundSummary } from './ground-types.js';

/** 列出训练场根下的全部训练场（含未托管目录）/ list every ground under the root, including unmanaged directories */
export async function listTrainingGrounds(root: string): Promise<TrainingGroundSummary[]> {
  if (!(await pathExists(root))) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const summaries: TrainingGroundSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    const path = join(root, entry.name);
    summaries.push(await summarize(path, entry.name));
  }
  return summaries.sort((left, right) => left.name.localeCompare(right.name));
}

/** 读取单个训练场；不存在时抛出 TRAINING_NOT_FOUND / read one ground, throwing TRAINING_NOT_FOUND when absent */
export async function readTrainingGround(
  root: string,
  name: string,
): Promise<{ summary: TrainingGroundSummary; meta: TrainingGroundMeta | null }> {
  const path = resolveTrainingDir(root, name);
  if (!(await isDirectory(path))) {
    throw new CliError(`训练场不存在 / training ground not found: ${name}`, {
      code: 'TRAINING_NOT_FOUND',
      details: { name, path },
    });
  }
  const meta = await readMeta(path);
  return { summary: await summarize(path, name), meta };
}

/** 生成摘要 / build the summary for one directory */
async function summarize(path: string, name: string): Promise<TrainingGroundSummary> {
  const meta = await readMeta(path);
  const profile = meta?.profile ?? DEFAULT_PROFILE;
  const [hasCredentials, hasProfile] = await Promise.all([
    pathExists(join(path, CREDENTIALS_FILENAME)),
    pathExists(join(path, 'profiles', profile, 'package.json')),
  ]);
  return {
    name,
    path,
    managed: meta !== null,
    profile,
    sourceHome: meta?.sourceHome ?? null,
    sourceProfile: meta?.sourceProfile ?? null,
    createdAt: meta?.createdAt ?? null,
    hasCredentials,
    hasProfile,
  };
}
