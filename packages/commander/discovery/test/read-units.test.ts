/**
 * 单元读取测试：package.json 与 Cargo.toml 到 Unit 的归一化。
 *
 * Unit-reading tests: normalizing package.json and Cargo.toml into Units.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, afterEach, describe, expect, it } from 'vitest';
import type { FileSystem } from '@deepseek-ai/dsh-fs';
import { readCargoUnit, readNpmUnit } from '../src/discovery';
import { captureStderr, cleanRoots, createLocalFs, makeRoot } from './helpers';

/** 注入的 ctx.fs 文件系统服务（dsh-fs 本地后端）/ the injected ctx.fs filesystem service (the dsh-fs local backend) */
let fs: FileSystem;

beforeAll(() => {
  fs = createLocalFs();
});

afterEach(() => {
  cleanRoots();
});

describe('readNpmUnit / readCargoUnit', () => {
  it('读取 npm 单元并归一化 dir 分隔符 / reads an npm unit with normalized dir separators', async () => {
    const root = makeRoot();
    const dir = join(root, 'pkg-a');
    mkdirSync(dir);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@x/pkg-a', description: 'demo' }));
    expect(await readNpmUnit(fs, dir, root)).toEqual({ name: '@x/pkg-a', description: 'demo', dir: 'pkg-a' });
  });

  it('package.json 缺 name 时视为非单元 / treats a package.json without a name as a non-unit', async () => {
    const root = makeRoot();
    const dir = join(root, 'anon');
    mkdirSync(dir);
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '0.0.0' }));
    expect(await readNpmUnit(fs, dir, root)).toBeNull();
  });

  it('读取 Rust 单元 / reads a Rust unit', async () => {
    const root = makeRoot();
    const dir = join(root, 'apps', 'web');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname = "x-web"\ndescription = "web app"\n');
    expect(await readCargoUnit(fs, dir, root)).toEqual({ name: 'x-web', description: 'web app', dir: 'apps/web' });
  });

  it('没有清单文件时返回 null / returns null without any manifest', async () => {
    const root = makeRoot();
    const dir = join(root, 'empty');
    mkdirSync(dir);
    expect(await readNpmUnit(fs, dir, root)).toBeNull();
    expect(await readCargoUnit(fs, dir, root)).toBeNull();
  });

  it('package.json 损坏时向 stderr 告警并返回 null / warns on stderr and returns null for a corrupted package.json', async () => {
    const root = makeRoot();
    const dir = join(root, 'broken');
    mkdirSync(dir);
    writeFileSync(join(dir, 'package.json'), '{ not json');
    const warnings = await captureStderr(async () => {
      expect(await readNpmUnit(fs, dir, root)).toBeNull();
    });
    expect(warnings).toContain('unparseable manifest');
  });
});
