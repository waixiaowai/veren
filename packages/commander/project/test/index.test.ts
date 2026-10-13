import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import LocalFileSystem from '@deepseek-ai/dsh-fs-local';
import * as YamlParser from '@veren/yaml-parser';
import { beforeAll, afterEach, describe, expect, it } from 'vitest';
import { CONFIG_FILE, findProjectRoot, loadConfig } from '../src/index';
import type { FileSystem } from '@deepseek-ai/dsh-fs';
import type { YamlParser as YamlParserService } from '@veren/yaml-parser';

/**
 * 全文件共享的运行时上下文：装载 YAML 解析插件并构造 dsh-fs 本地后端
 * （ctx.fs），与组装入口 createRuntime 的装配方式一致；两个服务取出后供
 * 各用例注入。
 *
 * A file-shared runtime context: installs the YAML parser plugin and builds
 * the dsh-fs local backend (ctx.fs), mirroring how the assembler's
 * createRuntime wires them; the two services are taken out and injected by
 * each case.
 */
let ctx: Context;
let fs: FileSystem;
let parser: YamlParserService;

beforeAll(async () => {
  ctx = new Context();
  await ctx.plugin(YamlParser);
  new LocalFileSystem(ctx, LocalFileSystem.Config({}));
  fs = ctx.fs;
  parser = ctx.get(YamlParser.name)!;
});

/**
 * 每个用例独立的临时项目根，afterEach 统一删除。
 * A per-test temporary project root, removed together in afterEach.
 */
let root: string;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = '';
});

/** 创建临时项目根并写入指定 .veren.yaml 内容 / create a temp project root with the given config text */
function makeRoot(configText?: string): string {
  root = mkdtempSync(join(tmpdir(), 'veren-commander-project-'));
  if (configText !== undefined) writeFileSync(join(root, CONFIG_FILE), configText, 'utf8');
  return root;
}

describe('findProjectRoot', () => {
  it('从嵌套目录向上找到 .veren.yaml 所在目录 / walks up from a nested dir to the config dir', async () => {
    const dir = makeRoot('scan: [apps]\n');
    const nested = join(dir, 'a', 'b');
    mkdirSync(nested, { recursive: true });
    expect(await findProjectRoot(fs, nested)).toBe(dir);
  });

  it('找不到配置时抛出 CliError / throws a CliError when no config exists', async () => {
    // 进程临时目录深处没有任何 .veren.yaml，向上也几乎不可能命中
    // A deep temp path without any .veren.yaml; ancestors should not hold one either
    const dir = mkdtempSync(join(tmpdir(), 'veren-commander-noroot-'));
    try {
      const nested = join(dir, 'x', 'y');
      mkdirSync(nested, { recursive: true });
      await expect(findProjectRoot(fs, nested)).rejects.toThrowError(/\.veren\.yaml/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('loadConfig', () => {
  it('scan 缺省时回退内置默认根 / falls back to the built-in default roots', async () => {
    const dir = makeRoot('');
    for (const name of ['apps', 'packages', 'cargos']) mkdirSync(join(dir, name));
    expect(await loadConfig(dir, parser, fs)).toEqual({
      scanRoots: ['apps', 'packages', 'cargos'].map((name) => join(dir, name)),
    });
  });

  it('读取自定义 scan 根 / reads custom scan roots', async () => {
    const dir = makeRoot('scan:\n  - apps\n  - packages\n');
    mkdirSync(join(dir, 'apps'));
    mkdirSync(join(dir, 'packages'));
    expect((await loadConfig(dir, parser, fs)).scanRoots).toEqual([
      join(dir, 'apps'),
      join(dir, 'packages'),
    ]);
  });

  it('scan 类型不合法时抛出 CliError / throws a CliError on a non-string-array scan', async () => {
    const dir = makeRoot('scan: 42\n');
    await expect(loadConfig(dir, parser, fs)).rejects.toThrowError(/string array/);
  });

  it('scan 根目录不存在时抛出 CliError / throws a CliError when a scan root is missing', async () => {
    const dir = makeRoot('scan: [no-such-dir]\n');
    await expect(loadConfig(dir, parser, fs)).rejects.toThrowError(/no-such-dir/);
  });
});
