/**
 * 训练场路径解析与安全校验。
 *
 * Training-ground path resolution and safety checks.
 *
 * 这是"绝不误写 ~/.dsh"防线的入口：把插件配置解析成绝对路径、拒绝与源
 * DSH_HOME 重叠的根目录、校验训练场名是单层合法目录名，并保证解析出的
 * 训练场目录恰好位于根下。
 *
 * This is the entry point of the "never write ~/.dsh by accident" defense:
 * resolve plugin config into absolute paths, reject roots overlapping the
 * source DSH home, validate that a ground name is a single legal segment, and
 * prove the resolved ground directory sits exactly under its root.
 */

import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { CliError } from '@veren/commander-core';
import { isInside, normalizePath } from './ground-fs.js';
import { DEFAULT_PROFILE } from './ground-types.js';
import type { TrainingConfig, TrainingPaths } from './ground-types.js';

/**
 * 把插件配置解析为绝对路径并做安全校验。
 * Resolves plugin config into absolute paths and applies the safety checks.
 */
export function resolveTrainingPaths(config: TrainingConfig, projectRoot: string): TrainingPaths {
  const sourceHome = resolve(
    config.sourceHome.trim()
      || process.env.VEREN_TESTS_SOURCE_HOME?.trim()
      || join(homedir(), '.dsh'),
  );
  const root = resolve(
    config.root.trim()
      || process.env.VEREN_TESTS_ROOT?.trim()
      || join(projectRoot, 'deepseek', '.dsh'),
  );
  const harnessRoot = resolve(
    config.harnessRoot.trim()
      || process.env.VEREN_DSH_HARNESS?.trim()
      || join(projectRoot, 'deepseek', 'deepseek-harness'),
  );
  const profile = config.profile.trim() || DEFAULT_PROFILE;
  assertSafeTrainingRoot(root, sourceHome);
  return { root, sourceHome, harnessRoot, profile };
}

/**
 * 拒绝训练场根与全局 DSH_HOME 重叠，杜绝误写 ~/.dsh。
 * Rejects a training-ground root overlapping the global DSH home so ~/.dsh is
 * never written by accident.
 */
export function assertSafeTrainingRoot(root: string, sourceHome: string): void {
  const normalizedRoot = normalizePath(root);
  const normalizedSource = normalizePath(sourceHome);
  if (normalizedRoot === normalizedSource
    || isInside(normalizedRoot, normalizedSource)
    || isInside(normalizedSource, normalizedRoot)) {
    throw new CliError(
      `训练场根不能与源 DSH_HOME 重叠 / the training-ground root must not overlap the source DSH home: ${root} ↔ ${sourceHome}`,
      { code: 'TRAINING_ROOT_OVERLAP', details: { root, sourceHome } },
    );
  }
}

/**
 * 校验训练场名：单层目录名，拒绝路径分隔符与 Windows 保留名。
 * Validates a training-ground name: one path segment, no separators, and no
 * Windows reserved device names.
 */
export function assertTrainingName(name: string): void {
  const valid = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)
    && !name.endsWith('.')
    && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name);
  if (!valid) {
    throw new CliError(
      `非法训练场名 / invalid training-ground name: ${JSON.stringify(name)}（允许字母、数字、点、下划线、连字符，长度 1..64 / letters, digits, dot, underscore and hyphen, length 1..64）`,
      { code: 'TRAINING_INVALID_NAME', details: { name } },
    );
  }
}

/** 解析训练场绝对路径并确保它恰好位于根下 / resolve the absolute ground path and prove it is exactly under the root */
export function resolveTrainingDir(root: string, name: string): string {
  assertTrainingName(name);
  const resolvedRoot = resolve(root);
  const target = resolve(resolvedRoot, name);
  if (normalizePath(dirname(target)) !== normalizePath(resolvedRoot)) {
    throw new CliError(
      `训练场路径越界 / the training-ground path escapes its root: ${target}`,
      { code: 'TRAINING_PATH_ESCAPE', details: { root: resolvedRoot, name, path: target } },
    );
  }
  return target;
}
