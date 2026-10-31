/**
 * Discovery 测试的共享夹具：ctx.fs 后端、临时工作区与插件装载。
 *
 * Shared fixtures for the discovery suites: the ctx.fs backend, temporary
 * workspaces and plugin installation.
 *
 * makeRoot() 创建的目录与 install() 装载的 fiber 分别由 cleanRoots() /
 * disposeFibers() 在 afterEach 统一清理。
 *
 * Directories created by makeRoot() and fibers installed by install() are
 * cleaned up together in afterEach via cleanRoots() / disposeFibers().
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context, type Fiber } from '@deepseek-ai/cordis';
import LocalFileSystem from '@deepseek-ai/dsh-fs-local';
import type { FileSystem } from '@deepseek-ai/dsh-fs';
import { Project } from '@veren/commander-project';
import * as DiscoveryPlugin from '../src/index';
import { Discovery, type DiscoveryService } from '../src/service';
import type { ScanConfig } from '../src/discovery';

/** 创建注入用的 ctx.fs 本地文件系统后端 / create the injected ctx.fs local filesystem backend */
export function createLocalFs(): FileSystem {
  return new LocalFileSystem(new Context(), LocalFileSystem.Config({}));
}

/** 已创建、待清理的临时工作区 / temporary workspaces created and pending cleanup */
const roots: string[] = [];

/** 创建临时工作区并登记清理 / create a temporary workspace registered for cleanup */
export function makeRoot(): string {
  const created = mkdtempSync(join(tmpdir(), 'veren-commander-discovery-'));
  roots.push(created);
  return created;
}

/** 删除全部已登记的临时工作区 / remove every registered temporary workspace */
export function cleanRoots(): void {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
}

/** 以 root 为项目根构建 ScanConfig / build a ScanConfig rooted at root */
export function configFor(root: string, ...names: string[]): ScanConfig {
  return { scanRoots: names.map((name) => join(root, name)) };
}

/** 已装载、待卸载的 fiber / fibers installed and pending disposal */
const fibers: Array<Fiber> = [];

/**
 * 提供依赖服务并装载插件，返回服务：先提供 Project 服务与 ctx.fs 后端，
 * 再经 ctx.plugin 装载插件模块（Config schema 自动校验补全）。
 * Provides the dependencies and installs the plugin, returning the service:
 * the Project service and the ctx.fs backend first, then the plugin module
 * via ctx.plugin (its Config schema is validated and default-filled).
 */
export async function install(
  root: string,
  config?: Parameters<typeof DiscoveryPlugin.apply>[1],
): Promise<DiscoveryService> {
  const ctx = new Context();
  ctx.provide(Project, { root, config: { scanRoots: configFor(root, 'apps', 'cargos').scanRoots } });
  new LocalFileSystem(ctx, LocalFileSystem.Config({})); // 注册 ctx.fs / registers ctx.fs
  const fiber = ctx.plugin(DiscoveryPlugin, config);
  await fiber;
  fibers.push(fiber);
  return ctx.get(Discovery)!;
}

/** 卸载全部已装载的 fiber / dispose every installed fiber */
export async function disposeFibers(): Promise<void> {
  await Promise.allSettled(fibers.map((fiber) => fiber.dispose()));
  fibers.length = 0;
}

/**
 * 捕获 stderr 执行异步回调，返回期间的全部输出（测试后原样恢复）。
 * Runs an async callback with stderr captured and returns everything written
 * during it (the original writer is restored afterwards).
 */
export async function captureStderr(run: () => Promise<void>): Promise<string> {
  const captured: string[] = [];
  const original = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: unknown) => {
    captured.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    await run();
  } finally {
    process.stderr.write = original;
  }
  return captured.join('');
}
