/**
 * @veren/commander-build — build 命令插件：标准 Cordis 插件模块。
 *
 * @veren/commander-build — the build command plugin: a standard Cordis plugin
 * module.
 *
 * 遵循本仓库 Provider 约定（同 @veren/yaml-parser）：
 * Follows this repository's provider convention (same as @veren/yaml-parser):
 *   - name    插件显示名 / the plugin display name
 *   - inject  依赖的服务令牌 / required service tokens
 *   - Config  由 @deepseek-ai/schemastery 定义的插件配置 schema / the plugin
 *             config schema defined with @deepseek-ai/schemastery
 *   - apply   装配函数：向命令注册表注册 build 命令 / registers the build
 *             command with the command registry
 *
 * 分型构建：前端插件（浏览器 bundle）、后端插件（tsc 类发布）与 Rust crate
 * （cargo build）各自运行配置的命令；分型由 ./kind.ts 依清单文件决定。
 * Kind-aware building: frontend plugins (browser bundle), backend plugins
 * (tsc-style) and Rust crates (cargo build) each run their configured
 * command; the kind is decided in ./kind.ts from the manifest files.
 */

import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { getOrThrow } from '@veren/core';
import { CliError, Commands, Fs } from '@veren/commander-core';
import type { FileSystem } from '@deepseek-ai/dsh-fs';
import type { UnitInventory } from '@veren/commander-discovery';
import { Discovery } from '@veren/commander-discovery';
import { planBuild } from './kind.js';
import { runBuilds, unitCwd } from './build.js';
import type { PlannedBuild } from './build.js';
import { DEFAULT_CONFIG, Config } from './tokens.js';
import type { BuildPlan } from './tokens.js';

export type { BuildKind, BuildPlan } from './tokens.js';
export { planBuild } from './kind.js';
export { runBuilds, unitCwd, defaultSpawn } from './build.js';
export type { PlannedBuild, SpawnFn, BuildReporter } from './build.js';
export { Config, DEFAULT_CONFIG };

/** 插件显示名 / the plugin display name */
export const name = 'verenCliBuildCommand';

/** 依赖：命令注册表、Discovery 服务与 ctx.fs 文件系统 / requires the command registry, the Discovery service and ctx.fs */
export const inject = [Commands, Discovery, Fs];

/**
 * 插件装配：向命令注册表注册 build 命令，并把注销 disposer 交还 fiber ——
 * 插件卸载时命令自动注销。
 *
 * Plugin assembly: registers the build command with the registry and hands
 * the disposer back to the fiber — the command disappears when the plugin
 * unloads.
 */
export const apply = (ctx: Context, config: Config) => {
  return getOrThrow(ctx, Commands).register({
    name: 'build',
    usage: 'build <name...> | --all',
    // summary 单行较长但 help 生成器按整行渲染，故不拆行。
    // The summary is long but the help generator renders it as one line, so it is not split.
    summary:
      '构建工作区单元，按单元类型自动选择构建方式（前端插件 bundle / 后端插件 tsc / Cargo.toml 走 cargo） / build workspace units, picking the build per unit kind (frontend bundle, backend tsc, cargo for Cargo.toml)',
    run: (args) => cmdBuild(ctx, config, args),
  });
};

/**
 * build 命令引擎：解析出目标单元名（显式列出或 --all），逐个分型生成构建
 * 计划后按序执行，任一失败立即停止（fail-fast）。
 *
 * The build command engine: resolves target unit names (listed explicitly or
 * --all), plans each per its kind, then runs them in order; stops at the
 * first failure (fail-fast).
 */
export async function cmdBuild(ctx: Context, config: Config, args: readonly string[]): Promise<void> {
  const fs = getOrThrow<FileSystem>(ctx, Fs);
  const source = getOrThrow<UnitInventory>(ctx, Discovery);
  const units = await source.list();
  const byName = new Map(units.map((unit) => [unit.name, unit] as const));

  // 解析目标集合 / resolve the target set
  let names: readonly string[];
  if (args.length === 1 && args[0] === '--all') {
    names = units.map((unit) => unit.name);
  } else {
    if (args.length === 0) {
      throw new CliError('build 需要至少一个包名或 --all / build takes one or more package names, or --all', {
        code: 'BUILD_USAGE',
      });
    }
    for (const arg of args) {
      if (!byName.has(arg)) {
        throw new CliError(`未找到单元 / unit not found: ${arg}`, {
          code: 'UNIT_NOT_FOUND',
          details: { name: arg },
        });
      }
    }
    names = args;
  }
  if (names.length === 0) {
    process.stderr.write('build: 没有可构建的单元 / no units to build\n');
    return;
  }

  // 分型生成计划：每单元依清单选择 kind 与命令 / plan per unit kind from its manifest
  const planned: PlannedBuild[] = [];
  for (const unitName of names) {
    const unit = byName.get(unitName)!;
    const plan = await planBuild(fs, source.root, unit, config);
    planned.push({
      name: unit.name,
      plan: { kind: plan.kind, command: plan.command } satisfies BuildPlan,
      cwd: unitCwd(source.root, unit.dir),
    });
  }
  // 进度走 stderr，stdout 保持纯净 / progress on stderr, stdout stays clean
  await runBuilds(planned, (message) => process.stderr.write(`build: ${message}\n`));
}


