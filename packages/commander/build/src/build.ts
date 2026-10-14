/**
 * build 命令实现：按构建计划在单元目录下执觶定命令�?
 *
 * The build command implementation: runs each unit's planned command in the
 * unit directory.
 *
 * 实现�精�排acommand runner 结构化类型，不感�?Cordis —插件��
 ./index.ts �?apply。子进程 stdio 直接继承，构建工具彩色输出与枔厜�效�?
 *
 * The implementation only depends on a minimal structural Runner type and the
 * build plan; Cordis awareness lives in ./index.ts's apply. Child stdio is
 * inherited directly, so the build tool's colored output stays live.
 */

import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { CliError } from '@veren/commander-core';
import type { BuildPlan } from './tokens.js';

/** 已�从单元侧解析好的绝�盠��? the resolved absolute unit directory */
export interface PlannedBuild {
  /** 单先名称（报呋G����? the unit name (used in progress reporting) */
  name: string;
  /** 构建计划：分类与命令 / the plan: kind and command */
  plan: BuildPlan;
  /** 单元的绝对目� / the unit's absolute directory */
  cwd: string;
}

/** ����һ�н������ / one line of build progress output */
export type BuildReporter = (message: string) => void;

/** 钩子进程吊�噼�便测试替��default 使用 node:child_process�? / injectable process spawner for tests (default uses node:child_process) */
export type SpawnFn = (plan: PlannedBuild) => Promise<void>;

/**
 * 在单元目录下执�PlannedBuild的命令（shell 字�串）；交互式 stdio 继承�?
 * 非敬堰�出码�?CliError，机器可�?details 携带 cwd/command/kind�?
 *
 * Runs the planned command in the unit directory (as a shell string) with
 * inherited stdio; a non-zero exit becomes a CliError with machine-readable
 * details carrying cwd/command/kind.
 */
export const defaultSpawn: SpawnFn = async (planned: PlannedBuild): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(planned.plan.command, {
      cwd: planned.cwd,
      stdio: 'inherit',
      shell: true, // Windows �?npm/pnpm 吊�器是 .cmd，必须走 shell / npm and pnpm launchers are .cmd on Windows; a shell is required
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new CliError(`构建失败 / build failed: ${planned.name} (${planned.plan.kind})，退出码 / exit code ${code}`, {
        code: 'BUILD_FAILED',
        details: { name: planned.name, kind: planned.plan.kind, command: planned.plan.command, exitCode: code },
      }));
    });
  });
};

/**
 * 価指�?name 构建；任��已最命中即停步（fail-fast）�?
 * Runs the given builds in order; stops at the first failure (fail-fast).
 */
export async function runBuilds(
  planned: readonly PlannedBuild[],
  report: BuildReporter,
  spawnFn: SpawnFn = defaultSpawn,
): Promise<void> {
  for (const item of planned) {
    report(`[${item.plan.kind}] building ${item.name}: ${item.plan.command}`);
    await spawnFn(item);
    report(`[ok] ${item.name}`);
  }
}

/** 单元名显射为绝�級�素冕盽�的工具函数？root 合成 cwd / resolves a unit's absolute cwd from root and relative dir */
export function unitCwd(root: string, dir: string): string {
  return join(root, ...dir.split('/'));
}
