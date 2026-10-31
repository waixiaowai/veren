/**
 * 训练场元数据的读取与校验。
 *
 * Reading and validating training-ground metadata.
 *
 * 元数据文件（MARKER_FILENAME）是"托管"的标志：存在且字段完整才算本命令
 * 创建的训练场；缺失或损坏一律视为未托管目录，删除时必须显式 --force。
 *
 * The metadata file (MARKER_FILENAME) marks a ground as managed: only a file
 * with every field present counts as created by this command. Missing or
 * corrupt metadata always means an unmanaged directory, and removal then
 * requires an explicit --force.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MARKER_FILENAME } from './ground-types.js';
import type { TrainingGroundMeta } from './ground-types.js';

/** 读取元数据；缺失或格式非法返回 null / read metadata; null when missing or malformed */
export async function readMeta(path: string): Promise<TrainingGroundMeta | null> {
  let text: string;
  try {
    text = await readFile(join(path, MARKER_FILENAME), 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return isMeta(parsed) ? parsed : null;
  } catch (error) {
    // 元数据损坏视为未托管目录；删除时仍需 --force，避免误删。
    // Corrupt metadata means an unmanaged directory; removal still needs --force.
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

/** 判断元数据字段是否完整 / whether the metadata fields are complete */
function isMeta(value: unknown): value is TrainingGroundMeta {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return record.version === 1
    && typeof record.name === 'string'
    && typeof record.createdAt === 'string'
    && typeof record.sourceHome === 'string'
    && typeof record.sourceProfile === 'string'
    && typeof record.harnessRoot === 'string'
    && typeof record.profile === 'string';
}
