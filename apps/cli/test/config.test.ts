import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CONFIG_FILE, findProjectRoot, loadConfig } from '../src/config';

/**
 * 每个用例独立的临时项目根，afterAfterEach 统一删除。
 * A per-test temporary project root, removed together in afterEach.
 */
let root: string;

afterEach(() => {
  if (root) rmSync(root, { recursive: true, force: true });
  root = '';
});

/** 创建临时项目根并写入指定 .veren.yaml 内容 / create a temp project root with the given config text */
function makeRoot(configText?: string): string {
  root = mkdtempSync(join(tmpdir(), 'veren-cli-config-'));
  if (configText !== undefined) writeFileSync(join(root, CONFIG_FILE), configText, 'utf8');
  return root;
}

describe('findProjectRoot', () => {
  it('从嵌套目录向上找到 .veren.yaml 所在目录 / walks up from a nested dir to the config dir', () => {
    const dir = makeRoot('scan: [apps]\n');
    const nested = join(dir, 'a', 'b');
    mkdirSync(nested, { recursive: true });
    expect(findProjectRoot(nested)).toBe(dir);
  });

  it('找不到配置时抛出 CliError / throws a CliError when no config exists', () => {
    // 进程临时目录深处没有任何 .veren.yaml，向上也几乎不可能命中
    // A deep temp path without any .veren.yaml; ancestors should not hold one either
    const dir = mkdtempSync(join(tmpdir(), 'veren-cli-noroot-'));
    try {
      const nested = join(dir, 'x', 'y');
      mkdirSync(nested, { recursive: true });
      expect(() => findProjectRoot(nested)).toThrowError(/\.veren\.yaml/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('loadConfig', () => {
  it('scan 缺省时回退内置默认根 / falls back to the built-in default roots', () => {
    const dir = makeRoot('');
    for (const name of ['apps', 'packages', 'cargos']) mkdirSync(join(dir, name));
    expect(loadConfig(dir)).toEqual({
      scanRoots: ['apps', 'packages', 'cargos'].map((name) => join(dir, name)),
    });
  });

  it('读取自定义 scan 根 / reads custom scan roots', () => {
    const dir = makeRoot('scan:\n  - apps\n  - packages\n');
    mkdirSync(join(dir, 'apps'));
    mkdirSync(join(dir, 'packages'));
    expect(loadConfig(dir).scanRoots).toEqual([join(dir, 'apps'), join(dir, 'packages')]);
  });

  it('scan 类型不合法时抛出 CliError / throws a CliError on a non-string-array scan', () => {
    const dir = makeRoot('scan: 42\n');
    expect(() => loadConfig(dir)).toThrowError(/string array/);
  });

  it('scan 根目录不存在时抛出 CliError / throws a CliError when a scan root is missing', () => {
    const dir = makeRoot('scan: [no-such-dir]\n');
    expect(() => loadConfig(dir)).toThrowError(/no-such-dir/);
  });
});
