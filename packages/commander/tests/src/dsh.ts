/**
 * 通过 DSH 源码启动训练场：profile 初始化与 web 服务运行。
 *
 * Booting a training ground through the DSH source checkout: profile
 * initialization and web serving.
 *
 * 所有子进程都在清理过的环境里运行：剥掉 DSH_* 与疑似密钥变量，再显式注入
 * 训练场自己的 DSH_HOME，避免训练场意外连到当前会话或全局配置。
 *
 * Every child process runs in a cleaned environment: DSH_* and secret-looking
 * variables are stripped, then the training ground's own DSH_HOME is injected,
 * so it can never attach to this session or the global configuration.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { CliError } from '@veren/commander-core';
import type { StartTrainingGroundOptions, TrainingGroundRef } from './ground.js';

/** 捕获输出的上限 / the capture limit for child output */
const CAPTURE_LIMIT = 16_384;

/** 子进程输出 / child output */
interface CapturedOutput {
  /** 标准输出 / standard output */
  stdout: string;
  /** 标准错误 / standard error */
  stderr: string;
}

/** 清理后的环境 / the cleaned environment */
export function cleanEnvironment(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const cleaned: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(base)) {
    if (value === undefined) continue;
    if (/^DSH_/i.test(name)) continue;
    if (/(KEY|PASSWORD|SECRET|TOKEN)/i.test(name)) continue;
    cleaned[name] = value;
  }
  return cleaned;
}

/**
 * 通过源码运行 dsh 子命令；失败时抛出带退出码和输出尾部的 CliError。
 * Runs a dsh subcommand from source; a failure throws a CliError carrying the
 * exit code and the tail of the child output.
 */
export async function runDsh(
  harnessRoot: string,
  home: string,
  args: readonly string[],
  mode: 'capture' | 'inherit',
): Promise<void> {
  const entry = join(harnessRoot, 'apps', 'cli', 'src', 'bin.ts');
  if (!(await pathExists(entry))) {
    throw new CliError(
      `找不到 DSH 源码入口 / DSH source entry not found: ${entry}`,
      { code: 'DSH_HARNESS_NOT_FOUND', details: { harnessRoot, entry } },
    );
  }
  const child = spawn(process.execPath, ['--import', 'tsx/esm', entry, ...args], {
    cwd: harnessRoot,
    env: { ...cleanEnvironment(), DSH_HOME: home },
    stdio: mode === 'inherit' ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  if (mode === 'inherit') {
    await waitForExit(child);
    return;
  }

  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => { stdout = appendTail(stdout, chunk); });
  child.stderr?.on('data', (chunk: Buffer) => { stderr = appendTail(stderr, chunk); });
  await waitForExit(child, () => ({ stdout, stderr }));
}

/** 初始化 profile：version-exemptions 会写出 profile 模板文件 / initialize the profile: version-exemptions writes the template files */
export function createDefaultInitializer(): (ground: TrainingGroundRef) => Promise<void> {
  return async (ground) => {
    await runDsh(
      ground.harnessRoot,
      ground.path,
      ['plugin', '--profile', ground.profile, 'version-exemptions'],
      'capture',
    );
  };
}

/** 启动训练场的 web 服务，继承 stdio 直到退出 / start the ground's web server with inherited stdio until it exits */
export async function startTrainingGround(
  ground: TrainingGroundRef,
  options: StartTrainingGroundOptions,
): Promise<void> {
  const args = ['web', '--port', String(options.port)];
  if (!options.open) args.push('--no-open');
  await runDsh(ground.harnessRoot, ground.path, args, 'inherit');
}

/** 追加输出并只保留尾部 / append output, keeping only the tail */
function appendTail(current: string, chunk: Buffer): string {
  const next = current + chunk.toString('utf8');
  return next.length > CAPTURE_LIMIT ? next.slice(-CAPTURE_LIMIT) : next;
}

/** 等待子进程结束；非零退出转为 CliError / wait for the child; a non-zero exit becomes a CliError */
function waitForExit(
  child: ChildProcess,
  capture?: () => CapturedOutput,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      reject(spawnError(error));
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve();
        return;
      }
      reject(exitError(code, signal, capture?.()));
    });
  });
}

/** spawn 失败的 CliError / the CliError for a failed spawn */
function spawnError(error: Error): CliError {
  return new CliError(`无法启动 dsh / failed to spawn dsh: ${error.message}`, {
    code: 'DSH_SPAWN_FAILED',
    details: { message: error.message },
  });
}

/** 非零退出（含信号与输出尾部）的 CliError / the CliError for a non-zero exit (signal and output tail included) */
function exitError(
  code: number | null,
  signal: NodeJS.Signals | null,
  output?: CapturedOutput,
): CliError {
  return new CliError(
    `dsh 命令失败 / dsh command failed (exit ${code ?? 'null'}${signal ? `, signal ${signal}` : ''})`,
    {
      code: 'DSH_COMMAND_FAILED',
      details: {
        exitCode: code,
        signal,
        stdout: output?.stdout.trim(),
        stderr: output?.stderr.trim(),
      },
    },
  );
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
