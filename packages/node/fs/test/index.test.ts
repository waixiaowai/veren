import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { afterEach, describe, expect, it } from 'vitest';
import * as NodeFsPlugin from '../src/index';
import { apply, Config, inject, name } from '../src/index';
import { createNodeFs } from '../src/service';

/**
 * 每个用例使用独立的 cordis Context 和独立临时目录；disposer 统一收进
 * disposers，在 afterEach 中清理，避免服务与文件跨用例泄漏。
 *
 * Every test builds its own cordis Context and its own temp directory.
 * Disposers are collected here and disposed in afterEach so no service or
 * file leaks across cases.
 */
const disposers: Array<() => unknown> = [];
let tmpDir = '';

afterEach(async () => {
  await Promise.allSettled(disposers.map((dispose) => dispose()));
  disposers.length = 0;
  if (tmpDir) {
    await fsp.rm(tmpDir, { recursive: true, force: true });
    tmpDir = '';
  }
});

/** 创建带独立临时目录的服务 / creates the service with a fresh temp directory */
async function setup(config = Config({})) {
  tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'veren-fs-'));
  const ctx = new Context();
  disposers.push(apply(ctx, config));
  return { ctx, fs: ctx.get(name)! };
}

describe('nodeFs provider', () => {
  it('name 是带 veren 前缀的字符串令牌，inject 无依赖 / name is a veren-prefixed token and inject is empty', () => {
    expect(name).toBe('verenNodeFs');
    expect(inject).toEqual([]);
  });

  it('Config({}) 归一化默认编码为 utf8 / Config({}) normalizes to the utf8 default', () => {
    expect(Config({})).toEqual({ encoding: 'utf8' });
    expect(Config({ encoding: 'utf16le' })).toEqual({ encoding: 'utf16le' });
  });

  it('Config 拒绝非声明的编码 / Config rejects an undeclared encoding', () => {
    expect(() => Config({ encoding: 'base64' as never })).toThrow();
  });

  it('apply 把文件系统服务提供到上下文 / apply provides the fs service to the context', async () => {
    const { ctx, fs } = await setup();
    expect(fs).toBeDefined();
    expect(ctx.get('verenNodeFs')).toBe(fs);
    expect(fs.readFile).toBeTypeOf('function');
  });

  it('经上下文消费：ctx.plugin 不传配置时 schema 填充默认值 / context consumption fills schema defaults', async () => {
    const ctx = new Context();
    await ctx.plugin(NodeFsPlugin);
    expect(ctx.get(name)).toBeDefined();
  });
});

describe('nodeFs service', () => {
  it('writeFile / readFile / appendFile 按默认编码工作 / write, read and append use the default encoding', async () => {
    const { fs } = await setup();
    const file = path.join(tmpDir, 'a.txt');
    await fs.writeFile(file, 'hello');
    expect(await fs.readFile(file)).toBe('hello');
    await fs.appendFile(file, ' world');
    expect(await fs.readFile(file)).toBe('hello world');
  });

  it('显式 encoding 参数覆盖默认值 / an explicit encoding overrides the default', async () => {
    const { fs } = await setup();
    const file = path.join(tmpDir, 'b.txt');
    await fs.writeFile(file, 'héllo', 'latin1');
    expect(await fs.readFile(file, 'latin1')).toBe('héllo');
  });

  it('exists 对存在与不存在的路径都不抛错 / exists never throws', async () => {
    const { fs } = await setup();
    expect(await fs.exists(tmpDir)).toBe(true);
    expect(await fs.exists(path.join(tmpDir, 'missing'))).toBe(false);
  });

  it('mkdir recursive 逐级创建，readdir 列出目录项 / recursive mkdir then readdir', async () => {
    const { fs } = await setup();
    const nested = path.join(tmpDir, 'x', 'y');
    await fs.mkdir(nested, { recursive: true });
    // 已存在的目录重复创建不报错 / recreating an existing directory is fine
    await fs.mkdir(nested, { recursive: true });
    await fs.writeFile(path.join(nested, 'c.txt'), 'x');
    expect(await fs.readdir(nested)).toEqual(['c.txt']);
  });

  it('stat / rename / copyFile / rm 组合可用 / stat, rename, copyFile and rm compose', async () => {
    const { fs } = await setup();
    const src = path.join(tmpDir, 'd.txt');
    await fs.writeFile(src, 'data');
    expect((await fs.stat(src)).isFile()).toBe(true);

    const moved = path.join(tmpDir, 'e.txt');
    await fs.rename(src, moved);
    const copied = path.join(tmpDir, 'f.txt');
    await fs.copyFile(moved, copied);
    expect(await fs.readFile(copied)).toBe('data');

    await fs.rm(copied);
    expect(await fs.exists(copied)).toBe(false);
  });

  it('createNodeFs 直接构造（不经上下文）/ createNodeFs works without a context', async () => {
    const file = path.join(tmpDir || os.tmpdir(), `direct-${Date.now()}.txt`);
    const fs = createNodeFs({ encoding: 'utf8' });
    await fs.writeFile(file, 'ok');
    expect(await fs.readFile(file)).toBe('ok');
    await fs.rm(file);
  });
});
