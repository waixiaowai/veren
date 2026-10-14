/**
 * 构建分型识别：从单元盽�的清单文仈�斖�建属于佉种构建�?
 *
 * Build kind detection: decides which kind of build a unit directory needs,
 * from its manifest files.
 *
 * 判定规则 / Detection rules:
 *   - 盽�含� Cargo.toml ：T Rust crate（cargo build）�?
 *     A Cargo.toml marks a Rust crate (cargo build).
 *   - 否则诧־� package.json：包�?dsh.client 字�（参�?deepseek-harness 前缀插件
 *     约定）或 veren.frontend === true 时�为前�插件（浏览器 bundle），
 *     否则为后�·插件（tsc 籾发布）�?
 *     Otherwise read package.json: a dsh.client field (the deepseek-harness
 *     frontend-plugin convention) or veren.frontend === true marks a frontend
 *     plugin (browser bundle); everything else is a backend plugin (tsc-style).
 *   - 清单服�时性报 CliError，不静默回��Ɏ�·构建（构建错盠�比无声卮更危险）�?
 *     A corrupted manifest throws a CliError instead of silently falling back
 *     to a backend build (building the wrong target is worse than a loud stop).
 *
 * 文件能力复用 @deepseek-ai/dsh-fs �?ctx.fs 服务；路径拼接使�?node:path�?
 * File capabilities reuse the ctx.fs service from @deepseek-ai/dsh-fs; path
 * joining uses node:path.
 */

import { join } from 'node:path';
import type { FileSystem } from '@deepseek-ai/dsh-fs';
import { CliError } from '@veren/commander-core';
import type { BuildKind, BuildPlan, Config } from './tokens.js';

/** 单元内部絡一使用相�寷�径（find 提�供� / unit dirs are root-relative; resolve against the root */
export interface UnitLike {
  /** 相�项盒根的盽�位置（以 / 分割�? directory relative to the project root (forward slashes) */
  dir: string;
}

/** path 存在性：lstat 非空即存�?/ path existence: a defined lstat means present */
async function exists(fs: FileSystem, path: string): Promise<boolean> {
  return (await fs.lstat(path)) !== undefined;
}

/** 整体诧֏� UTF-8 文本 / read the whole UTF-8 text */
async function readText(fs: FileSystem, path: string): Promise<string> {
  return fs.readText(await fs.resolve(path));
}

/** package.json 演缌� / the shape of package.json this module inspects */
interface ManifestView {
  dsh?: { client?: unknown };
  veren?: { frontend?: unknown };
}

/**
 * 识别一不�元的构建分类并�y照配署�命令，产生叉�行的构建计划�?
 * fs 为注入的 ctx.fs 文件系统服务，root 为项�目根，unit.dir 为相对路径�?
 *
 * Classifies one unit and picks the configured command, producing an
 * executable build plan. fs is the injected ctx.fs filesystem service; root
 * is the project root; unit.dir is root-relative.
 */
export async function planBuild(
  fs: FileSystem,
  root: string,
  unit: UnitLike,
  config: Config,
): Promise<{ kind: BuildKind } & BuildPlan> {
  // dir �?/ 分割，join 前先归一化为平台跾� / dir uses forward slashes; normalize before join
  const dir = join(root, ...unit.dir.split('/'));

  // Rust crate 先判�ǸCargo.toml 优先 / Rust first: Cargo.toml wins
  if (await exists(fs, join(dir, 'Cargo.toml'))) {
    return { kind: 'rust', command: config.rustCommand };
  }

  const manifestPath = join(dir, 'package.json');
  if (!(await exists(fs, manifestPath))) {
    throw new CliError(`朄�元无 package.json ���Ctoml，无法判定构廹方�? / unit has neither package.json nor Cargo.toml; build kind unknown: ${unit.dir}`, {
      code: 'BUILD_KIND_UNKNOWN',
      details: { dir: unit.dir },
    });
  }

  let manifest: ManifestView;
  try {
    manifest = JSON.parse(await readText(fs, manifestPath)) as ManifestView;
  } catch (error) {
    throw new CliError(`package.json 无法解析 / unparseable package.json: ${manifestPath} (${error instanceof Error ? error.message : String(error)})`, {
      code: 'MANIFEST_UNPARSEABLE',
      details: { dir: unit.dir },
    });
  }

  // 前缀插件：client 注入约定或显式标记；�״命令时回臸图指令�?
  // Frontend plugin: the client-injection convention or an explicit flag; fall
  // back when the unit lacks the configured script.
  const isFrontend = manifest.dsh?.client !== undefined || manifest.veren?.frontend === true;
  if (isFrontend) {
    const command = await pickScriptCommand(fs, dir, config.frontendCommand, config.frontendFallbackCommand);
    return { kind: 'frontend', command };
  }
  return { kind: 'backend', command: config.backendCommand };
}

/**
 * 每刺字边判断命令昐�依�C��都运行฀次命令操作筋 / whether the configured command runs a package script
 */
function scriptOf(command: string): string | undefined {
  // 仅识刈� script � / only recognize `npm run <script>` style
  const match = /^(?:npm|pnpm|yarn)\s+(?:run\s+)?(\S+)/.exec(command.trim());
  return match?.[1];
}

/** 脚本缺失时回�ɠ指定包组慚童�，个案仑向�备指� / falls back when the unit lacks the configured script */
async function pickScriptCommand(fs: FileSystem, dir: string, command: string, fallback: string): Promise<string> {
  const script = scriptOf(command);
  if (script === undefined) return command;
  try {
    const pkg = JSON.parse(await readText(fs, join(dir, 'package.json'))) as { scripts?: Record<string, unknown> };
    if (pkg.scripts?.[script] !== undefined) return command;
  } catch {
    // 清单前面已解析通过，�敡拡座捔臗�静默 / the manifest parsed earlier; a reread failure falls through
  }
  return fallback;
}

