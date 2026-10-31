/**
 * 训练场的创建：复制源配置、写隔离 .npmrc、初始化 profile、合并模型补丁、
 * 落元数据。
 *
 * Creating a training ground: copy the source configuration, write the
 * isolated .npmrc, initialize the profile, merge the model patch and write
 * the metadata.
 *
 * 创建步骤遵循 README 的顺序：复制密钥 → 写隔离的 profile .npmrc → 通过 dsh
 * 初始化 profile → 复制模型补丁 → 写训练场元数据；任一步失败只清理本次新建
 * 的目录。
 *
 * Creation follows the documented order: copy credentials, write the isolated
 * profile .npmrc, initialize the profile through dsh, copy the model patch,
 * then write the metadata. Any failure cleans up only the directory this call
 * created.
 */

import { chmod, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join } from 'node:path';
import { CliError } from '@veren/commander-core';
import {
  extractModelEntries,
  mergeModelEntries,
  parsePatchArray,
  parsePatchEntries,
  renderPatch,
  type PatchEntry,
} from './model-config.js';
import { messageOf, pathExists, readOptionalText } from './ground-fs.js';
import { resolveTrainingDir } from './ground-paths.js';
import { CREDENTIALS_FILENAME, MARKER_FILENAME } from './ground-types.js';
import type {
  CreateTrainingGroundDeps,
  CreateTrainingGroundOptions,
  CreateTrainingGroundResult,
  TrainingGroundMeta,
} from './ground-types.js';

/** 缺省模型配置来源 profile（回退顺序）/ default source profiles for model configuration (fallback order) */
const FALLBACK_SOURCE_PROFILES = ['desktop', 'web'];

/** 创建训练场；失败时清理本次创建的目录 / create a ground and remove the directory this call created on failure */
export async function createTrainingGround(
  options: CreateTrainingGroundOptions,
  deps: CreateTrainingGroundDeps,
): Promise<CreateTrainingGroundResult> {
  const path = resolveTrainingDir(options.root, options.name);
  await assertSourceCredentials(options.sourceHome);
  if (await pathExists(path)) {
    throw new CliError(`训练场已存在 / training ground already exists: ${options.name}`, {
      code: 'TRAINING_EXISTS',
      details: { name: options.name, path },
    });
  }
  const warnings: string[] = [];
  const sourceProfile = await chooseSourceProfile(options, warnings);
  if (options.dryRun) return dryRunResult(options, path, sourceProfile, warnings);
  return materializeGround(options, deps, path, sourceProfile, warnings);
}

/** 组装 dry-run 结果：只报探测结论，不写磁盘 / build the dry-run result: probe findings only, nothing written */
function dryRunResult(
  options: CreateTrainingGroundOptions,
  path: string,
  sourceProfile: string,
  warnings: string[],
): CreateTrainingGroundResult {
  return {
    dryRun: true,
    name: options.name,
    path,
    profile: options.profile,
    sourceProfile,
    sourceHome: options.sourceHome,
    copied: [],
    warnings,
  };
}

/** 实际落盘创建；失败时清理本次创建的目录 / materialize the ground; remove the directory this call created on failure */
async function materializeGround(
  options: CreateTrainingGroundOptions,
  deps: CreateTrainingGroundDeps,
  path: string,
  sourceProfile: string,
  warnings: string[],
): Promise<CreateTrainingGroundResult> {
  await mkdir(options.root, { recursive: true });
  await mkdir(path);
  try {
    return await populateGround(options, deps, path, sourceProfile, warnings);
  } catch (error) {
    // 创建失败时只删除本次新建的目录，不触碰根下其它训练场。
    // On failure remove only the directory this call created, never its siblings.
    await rm(path, { recursive: true, force: true, maxRetries: 3 });
    throw error;
  }
}

/** 复制配置、初始化 profile、合并模型补丁并写元数据 / copy config, initialize the profile, merge the model patch and write metadata */
async function populateGround(
  options: CreateTrainingGroundOptions,
  deps: CreateTrainingGroundDeps,
  path: string,
  sourceProfile: string,
  warnings: string[],
): Promise<CreateTrainingGroundResult> {
  const copied = await copySourceConfig(options.sourceHome, path);
  await writeProfileNpmrc(options.sourceHome, sourceProfile, path, options.profile);
  copied.push('profile-npmrc');
  await deps.initProfile({
    name: options.name,
    path,
    profile: options.profile,
    harnessRoot: options.harnessRoot,
  });
  const modelProfile = await copyModelPatch(options.sourceHome, sourceProfile, path, options.profile, warnings);
  const meta = await writeGroundMarker(options, deps, path, sourceProfile, modelProfile);
  if (modelProfile !== undefined) copied.push(`model-patch:${modelProfile}`);
  return {
    dryRun: false,
    name: options.name,
    path,
    profile: options.profile,
    sourceProfile: meta.sourceProfile,
    sourceHome: options.sourceHome,
    copied,
    warnings,
  };
}

/** 写训练场元数据文件 / write the training-ground metadata file */
async function writeGroundMarker(
  options: CreateTrainingGroundOptions,
  deps: CreateTrainingGroundDeps,
  path: string,
  sourceProfile: string,
  modelProfile: string | undefined,
): Promise<TrainingGroundMeta> {
  const meta: TrainingGroundMeta = {
    version: 1,
    name: options.name,
    createdAt: (deps.now?.() ?? new Date()).toISOString(),
    sourceHome: options.sourceHome,
    sourceProfile: modelProfile ?? sourceProfile,
    harnessRoot: options.harnessRoot,
    profile: options.profile,
  };
  await writeFile(join(path, MARKER_FILENAME), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
  return meta;
}

/** 复制密钥、.env 与旧版 settings.yaml / copy credentials, .env and legacy settings.yaml */
async function copySourceConfig(sourceHome: string, target: string): Promise<string[]> {
  const copied: string[] = [];
  await copySecret(join(sourceHome, CREDENTIALS_FILENAME), join(target, CREDENTIALS_FILENAME));
  copied.push('credentials');
  for (const [filename, label] of [['.env', 'env'], ['settings.yaml', 'settings']] as const) {
    const from = join(sourceHome, filename);
    if (!(await pathExists(from))) continue;
    await copySecret(from, join(target, filename));
    copied.push(label);
  }
  return copied;
}

/** 复制密钥文件并在 POSIX 上收紧为 0600 / copy a secret file and tighten it to 0600 on POSIX */
async function copySecret(from: string, to: string): Promise<void> {
  await copyFile(from, to, constants.COPYFILE_EXCL);
  if (process.platform !== 'win32') await chmod(to, 0o600);
}

/** 选择模型配置来源 profile：指定优先，否则按目标/desktop/web 探测 / pick the model source profile: explicit first, otherwise target/desktop/web */
async function chooseSourceProfile(
  options: CreateTrainingGroundOptions,
  warnings: string[],
): Promise<string> {
  const explicit = options.sourceProfile?.trim();
  const candidates = explicit
    ? [explicit]
    : [options.profile, ...FALLBACK_SOURCE_PROFILES].filter(uniqueProfile);
  for (const candidate of candidates) {
    const entries = await readModelEntries(options.sourceHome, candidate, warnings);
    if (entries.length > 0) return candidate;
  }
  return explicit || options.profile;
}

/** 读取某源 profile 的模型项；文件缺失或无模型项返回空数组 / read model entries from a source profile; absent file or no model entries yields [] */
async function readModelEntries(sourceHome: string, profile: string, warnings: string[]): Promise<PatchEntry[]> {
  const path = join(sourceHome, 'profiles', profile, 'cordis.patch.yml');
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  try {
    return extractModelEntries(parsePatchEntries(text));
  } catch (error) {
    warnings.push(`未能解析源模型配置 / could not parse source model patch ${path}: ${messageOf(error)}`);
    return [];
  }
}

/** 把源 profile 的模型项合并到目标 profile 补丁 / merge the source profile's model entries into the target profile patch */
async function copyModelPatch(
  sourceHome: string,
  sourceProfile: string,
  target: string,
  profile: string,
  warnings: string[],
): Promise<string | undefined> {
  const models = await readModelEntries(sourceHome, sourceProfile, warnings);
  if (models.length === 0) return undefined;
  const targetPatch = join(target, 'profiles', profile, 'cordis.patch.yml');
  const existing = await readExistingPatch(targetPatch, warnings);
  if (existing === undefined) return undefined;
  const entries = mergeModelEntries(existing, models);
  await mkdir(dirname(targetPatch), { recursive: true });
  await writeFile(targetPatch, renderPatch(entries), 'utf8');
  return sourceProfile;
}

/** 读取目标补丁；缺失视为空数组，格式非法则告警并跳过复制 / read the target patch; missing is empty, malformed warns and skips the copy */
async function readExistingPatch(
  path: string,
  warnings: string[],
): Promise<PatchEntry[] | undefined> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  try {
    return parsePatchArray(text);
  } catch (error) {
    // 目标补丁可能含无法安全重写的表达式；保留原文件比破坏它更安全。
    // The target patch may hold expressions we cannot safely rewrite; keeping it intact is safer.
    warnings.push(`保留未重写的目标补丁 / kept the target patch unwritten ${path}: ${messageOf(error)}`);
    return undefined;
  }
}

/** 写隔离的 profile .npmrc：独立 store + copy 安装，保留源 registry/凭据 / write an isolated profile .npmrc: own store + copy installs, keep source registry credentials */
async function writeProfileNpmrc(
  sourceHome: string,
  sourceProfile: string,
  target: string,
  profile: string,
): Promise<void> {
  const profileDir = join(target, 'profiles', profile);
  await mkdir(profileDir, { recursive: true });
  const sourcePath = join(sourceHome, 'profiles', sourceProfile, '.npmrc');
  const extras = (await readOptionalText(sourcePath))
    ?.split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .filter((line) => !/^\s*(store-dir|package-import-method)\s*=/i.test(line)) ?? [];
  const storeDir = join(target, '.pnpm-store').replaceAll('\\', '/');
  const lines = [
    '# veren training ground: isolated pnpm store; never share hardlinks with the global DSH home.',
    `store-dir=${storeDir}`,
    'package-import-method=copy',
    ...extras,
  ];
  await writeFile(join(profileDir, '.npmrc'), `${lines.join('\n')}\n`, 'utf8');
}

/** 断言源 DSH_HOME 有密钥 / require credentials in the source DSH home */
async function assertSourceCredentials(sourceHome: string): Promise<void> {
  const credentials = join(sourceHome, CREDENTIALS_FILENAME);
  if (!(await pathExists(credentials))) {
    throw new CliError(
      `源 DSH_HOME 缺少密钥文件 / the source DSH home has no credentials file: ${credentials}`,
      { code: 'SOURCE_CREDENTIALS_NOT_FOUND', details: { sourceHome, credentials } },
    );
  }
}

/** profile 去重 / deduplicate profile names */
function uniqueProfile(value: string, index: number, values: string[]): boolean {
  return values.indexOf(value) === index;
}
