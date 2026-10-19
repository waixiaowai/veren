/**
 * 训练场（隔离的 DSH_HOME）的创建、发现与清理。
 *
 * Creating, discovering and removing training grounds (isolated DSH homes).
 *
 * 训练场是本地测试节点：每个插件一个独立 DSH_HOME，密钥与模型配置从全局
 * ~/.dsh 复制过来，绝不读写全局目录。创建步骤遵循 README 的顺序：
 * 复制密钥 → 写隔离的 profile .npmrc → 通过 dsh 初始化 profile → 复制模型
 * 补丁 → 写训练场元数据。
 *
 * A training ground is a local test node: one DSH_HOME per plugin, with keys
 * and model configuration copied from the global ~/.dsh. The global directory
 * is never written. Creation follows the documented order: copy credentials,
 * write the isolated profile .npmrc, initialize the profile through dsh, copy
 * the model patch, then write the training-ground metadata.
 */

import { chmod, copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { CliError } from '@veren/commander-core';
import {
  extractModelEntries,
  mergeModelEntries,
  parsePatchArray,
  parsePatchEntries,
  renderPatch,
} from './model-config.js';

/** 训练场元数据文件名 / the training-ground metadata filename */
export const MARKER_FILENAME = '.veren-tests.json';

/** 密钥文件名 / the credentials filename */
export const CREDENTIALS_FILENAME = '.credentials.yaml';

/** 缺省 profile / the default profile */
export const DEFAULT_PROFILE = 'web';

/** 缺省模型配置来源 profile（回退顺序）/ default source profiles for model configuration (fallback order) */
const FALLBACK_SOURCE_PROFILES = ['desktop', 'web'];

/** 训练场根、源 DSH_HOME 与源码目录 / the training-ground root, source DSH home, and source checkout */
export interface TrainingPaths {
  /** 训练场根目录 / the training-ground root directory */
  root: string;
  /** 密钥来源 DSH_HOME / the DSH home that supplies credentials */
  sourceHome: string;
  /** DSH 源码目录 / the DSH source checkout */
  harnessRoot: string;
  /** 目标 profile / the target profile */
  profile: string;
}

/** 插件配置中的原始路径字段，空串表示使用缺省值 / raw path fields; empty strings mean defaults */
export interface TrainingConfig {
  /** 训练场根目录 / training-ground root */
  root: string;
  /** 密钥来源 DSH_HOME / source DSH home */
  sourceHome: string;
  /** DSH 源码目录 / the DSH source checkout */
  harnessRoot: string;
  /** 目标 profile / target profile */
  profile: string;
}

/** 指向一个已存在训练场的最小结构视图 / the minimal view of an existing training ground */
export interface TrainingGroundRef {
  /** 训练场名 / the training-ground name */
  name: string;
  /** 绝对路径（DSH_HOME）/ the absolute path (DSH_HOME) */
  path: string;
  /** profile 名 / the profile name */
  profile: string;
  /** DSH 源码目录 / the DSH source checkout */
  harnessRoot: string;
}

/** 训练场元数据 / training-ground metadata */
export interface TrainingGroundMeta {
  /** 元数据版本 / metadata version */
  version: 1;
  /** 训练场名 / the training-ground name */
  name: string;
  /** ISO 创建时间 / ISO creation time */
  createdAt: string;
  /** 源 DSH_HOME / the source DSH home */
  sourceHome: string;
  /** 复制模型配置的源 profile / the source profile the model configuration came from */
  sourceProfile: string;
  /** DSH 源码目录 / the DSH source checkout */
  harnessRoot: string;
  /** 目标 profile / the target profile */
  profile: string;
}

/** 列表/详情使用的训练场摘要 / the training-ground summary used by list and show */
export interface TrainingGroundSummary {
  /** 训练场名 / the training-ground name */
  name: string;
  /** 绝对路径 / the absolute path */
  path: string;
  /** 是否由本命令创建（有元数据）/ whether this command created it (metadata present) */
  managed: boolean;
  /** 目标 profile / the target profile */
  profile: string;
  /** 源 DSH_HOME，未托管时为 null / source DSH home, null when unmanaged */
  sourceHome: string | null;
  /** 源 profile，未托管时为 null / source profile, null when unmanaged */
  sourceProfile: string | null;
  /** ISO 创建时间，未托管时为 null / ISO creation time, null when unmanaged */
  createdAt: string | null;
  /** 是否已复制密钥 / whether credentials exist */
  hasCredentials: boolean;
  /** profile 是否已初始化 / whether the profile is initialized */
  hasProfile: boolean;
}

/** 创建结果 / the creation result */
export interface CreateTrainingGroundResult {
  /** 是否只做预检 / whether this was a dry run */
  dryRun: boolean;
  /** 训练场名 / the training-ground name */
  name: string;
  /** 绝对路径 / the absolute path */
  path: string;
  /** 目标 profile / the target profile */
  profile: string;
  /** 模型配置来源 profile，未复制时为 null / the source profile for model config, null when not copied */
  sourceProfile: string | null;
  /** 源 DSH_HOME / the source DSH home */
  sourceHome: string;
  /** 已复制的配置项 / copied configuration items */
  copied: string[];
  /** 非致命警告 / non-fatal warnings */
  warnings: string[];
}

/** 创建选项 / creation options */
export interface CreateTrainingGroundOptions extends TrainingPaths {
  /** 指定模型配置来源 profile；省略时自动探测 / explicit model source profile; auto-detected when omitted */
  sourceProfile?: string;
  /** 只预检，不写磁盘 / validate only, write nothing */
  dryRun?: boolean;
}

/** 创建所需的注入能力 / injected capabilities required by creation */
export interface CreateTrainingGroundDeps {
  /** 通过 dsh 初始化目标 profile / initialize the target profile through dsh */
  initProfile(ground: TrainingGroundRef): Promise<void>;
  /** 时钟，测试可替换 / clock, replaceable in tests */
  now?: () => Date;
}

/** 清理选项 / removal options */
export interface RemoveTrainingGroundOptions {
  /** 训练场根目录 / the training-ground root */
  root: string;
  /** 训练场名 / the training-ground name */
  name: string;
  /** 用户是否已明确授权删除 / whether the user explicitly authorized deletion */
  yes: boolean;
  /** 是否允许删除没有元数据的目录 / whether unmanaged directories may be removed */
  force: boolean;
  /** 只预检 / dry run */
  dryRun: boolean;
  /** 当前进程的 DSH_HOME，禁止删除 / the current DSH_HOME, which must never be removed */
  currentHome?: string;
}

/** 清理结果 / the removal result */
export interface RemoveTrainingGroundResult {
  /** 训练场名 / the training-ground name */
  name: string;
  /** 绝对路径 / the absolute path */
  path: string;
  /** 是否实际删除（dry run 为 false）/ whether it was removed (false on a dry run) */
  removed: boolean;
}

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
  if (options.dryRun) {
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

  await mkdir(options.root, { recursive: true });
  await mkdir(path);
  try {
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
  } catch (error) {
    // 创建失败时只删除本次新建的目录，不触碰根下其它训练场。
    // On failure remove only the directory this call created, never its siblings.
    await rm(path, { recursive: true, force: true, maxRetries: 3 });
    throw error;
  }
}

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

/** 读取元数据；缺失或格式非法返回 null / read metadata; null when missing or malformed */
async function readMeta(path: string): Promise<TrainingGroundMeta | null> {
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
async function readModelEntries(sourceHome: string, profile: string, warnings: string[]): Promise<unknown[]> {
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
  const existing = await readExistingPatch(targetPatch);
  if (existing === undefined) return undefined;
  const entries = mergeModelEntries(existing, models as Record<string, unknown>[]);
  await mkdir(dirname(targetPatch), { recursive: true });
  await writeFile(targetPatch, renderPatch(entries), 'utf8');
  return sourceProfile;
}

/** 读取目标补丁；缺失视为空数组，格式非法则告警并跳过复制 / read the target patch; missing is empty, malformed warns and skips the copy */
async function readExistingPatch(path: string): Promise<Record<string, unknown>[] | undefined> {
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
    void error;
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

/** 禁止删除当前运行中的 DSH_HOME / forbid removing the DSH_HOME this process runs in */
function assertNotCurrentHome(path: string, currentHome: string | undefined): void {
  if (currentHome !== undefined && normalizePath(path) === normalizePath(currentHome)) {
    throw new CliError(
      `不能删除当前运行的 DSH_HOME / refusing to remove the active DSH_HOME: ${path}`,
      { code: 'TRAINING_IN_USE', details: { path, currentHome } },
    );
  }
}

/** 读可选文本；不存在返回 undefined / read optional text; undefined when absent */
async function readOptionalText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

/** 路径是否存在 / whether the path exists */
async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** 路径是否为目录 / whether the path is a directory */
async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** 规范化路径用于比较；Windows 大小写不敏感 / normalize a path for comparison; Windows is case-insensitive */
function normalizePath(path: string): string {
  const resolved = resolve(path);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/** child 是否严格位于 parent 内 / whether child is strictly inside parent */
function isInside(parent: string, child: string): boolean {
  const relation = relative(parent, child);
  return relation.length > 0 && !relation.startsWith('..') && !isAbsolute(relation);
}

/** profile 去重 / deduplicate profile names */
function uniqueProfile(value: string, index: number, values: string[]): boolean {
  return values.indexOf(value) === index;
}

/** 提取错误消息 / extract an error message */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
