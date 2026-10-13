import { win32 } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { afterEach, describe, expect, it } from 'vitest';
import * as NodePathPlugin from '../src/index';
import { apply, Config, inject, name } from '../src/index';
import { createNodePath } from '../src/service';

/**
 * 每个用例使用独立的 cordis Context；disposer 统一收进 disposers，
 * 在 afterEach 中清理，避免服务跨用例泄漏（复用同一 Context 会报
 * "service already registered"）。
 *
 * Every test builds its own cordis Context. Disposers are collected here and
 * disposed in afterEach, so no service leaks across cases (reusing one
 * Context would fail with "service already registered").
 */
const disposers: Array<() => unknown> = [];

afterEach(async () => {
  await Promise.allSettled(disposers.map((dispose) => dispose()));
  disposers.length = 0;
});

describe('nodePath provider', () => {
  it('name 是带 veren 前缀的字符串令牌，inject 无依赖 / name is a veren-prefixed token and inject is empty', () => {
    expect(name).toBe('verenNodePath');
    expect(inject).toEqual([]);
  });

  it('Config({}) 在 Windows 上默认 win32，其他平台 posix / Config({}) defaults to win32 on Windows, posix elsewhere', () => {
    // 断言跟随宿主操作系统而非写死，保证测试在任何 CI 平台通过。
    // Assert against the host OS instead of a hardcoded value so the test
    // passes on any CI platform.
    expect(Config({})).toEqual({
      platform: process.platform === 'win32' ? 'win32' : 'posix',
    });
  });

  it('Config 显式固定风格并拒绝非法值 / Config pins a flavor and rejects invalid values', () => {
    expect(Config({ platform: 'posix' })).toEqual({ platform: 'posix' });
    expect(() => Config({ platform: 'darwin' as never })).toThrow();
  });

  it('apply 把路径服务提供到上下文 / apply provides the path service to the context', () => {
    const ctx = new Context();
    disposers.push(apply(ctx, Config({ platform: 'posix' })));
    const p = ctx.get(name)!;
    expect(p).toBeDefined();
    expect(ctx.get('verenNodePath')).toBe(p);
    expect(p.sep).toBe('/');
  });

  it('经上下文消费：ctx.plugin 不传配置时默认跟随操作系统 / context consumption defaults to the host OS', async () => {
    const ctx = new Context();
    await ctx.plugin(NodePathPlugin);
    expect(ctx.get(name)).toBeDefined();
  });
});

describe('nodePath service', () => {
  it('posix 风格用 / 分隔 / the posix flavor joins with /', () => {
    const p = createNodePath({ platform: 'posix' });
    expect(p.join('a', 'b', 'c.txt')).toBe('a/b/c.txt');
    expect(p.sep).toBe('/');
    expect(p.delimiter).toBe(':');
  });

  it('win32 风格用 \\ 分隔 / the win32 flavor joins with \\', () => {
    const p = createNodePath({ platform: 'win32' });
    expect(p.join('a', 'b', 'c.txt')).toBe('a\\b\\c.txt');
    expect(p.sep).toBe('\\');
    expect(p.delimiter).toBe(';');
  });

  it('dirname / basename / extname 拆解路径 / dirname, basename and extname decompose a path', () => {
    const p = createNodePath({ platform: 'posix' });
    const full = p.join('dir', 'file.tar.gz');
    expect(p.dirname(full)).toBe('dir');
    expect(p.basename(full)).toBe('file.tar.gz');
    expect(p.basename(full, '.gz')).toBe('file.tar');
    expect(p.extname(full)).toBe('.gz');
  });

  it('resolve / relative / normalize / isAbsolute 组合可用 / resolve, relative, normalize and isAbsolute compose', () => {
    const p = createNodePath({ platform: 'posix' });
    expect(p.isAbsolute(p.resolve('/a', 'b'))).toBe(true);
    expect(p.relative('/a/b', '/a/c')).toBe('../c');
    expect(p.normalize('a//b/../c')).toBe('a/c');
    expect(p.isAbsolute('a/b')).toBe(false);
  });

  it('平台固定后与 node:path 对应实现结果一致 / a pinned flavor matches the node:path implementation', () => {
    const p = createNodePath({ platform: 'win32' });
    // 直接对照 node:path.win32，锁定委托关系而非重复实现。
    // Compare against node:path.win32 directly to pin the delegation.
    expect(p.resolve('C:\\a', 'b')).toBe(win32.resolve('C:\\a', 'b'));
  });
});
