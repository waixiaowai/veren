/**
 * 训练场模块共享的文件系统与路径小工具。
 *
 * Small filesystem and path helpers shared by the training-ground modules.
 *
 * 这些函数只依赖 node:fs / node:path，供 ground-* 各职责模块复用，
 * 不含任何训练场业务语义。
 *
 * They depend only on node:fs / node:path and are reused by every ground-*
 * domain module; they carry no training-ground semantics of their own.
 */

import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';

/** 路径是否存在 / whether the path exists */
export async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** 路径是否为目录 / whether the path is a directory */
export async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** 读可选文本；不存在返回 undefined / read optional text; undefined when absent */
export async function readOptionalText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** 规范化路径用于比较；Windows 大小写不敏感 / normalize a path for comparison; Windows is case-insensitive */
export function normalizePath(path: string): string {
  const resolved = resolve(path);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** child 是否严格位于 parent 内 / whether child is strictly inside parent */
export function isInside(parent: string, child: string): boolean {
  const relation = relative(parent, child);
  return relation.length > 0 && !relation.startsWith('..') && !isAbsolute(relation);
}

/** 提取错误消息 / extract an error message */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
