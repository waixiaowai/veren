/**
 * build 命令测试：分型识别与按序构建（spawn 以桩替换，保证封闭）。
 *
 * Build command tests: kind detection and ordered builds (spawn stubbed,
 * keeping cases hermetic).
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CliError } from '@veren/commander-core';
import { Context } from '@deepseek-ai/cordis';
import LocalFileSystem from '@deepseek-ai/dsh-fs-local';
import { planBuild } from '../src/kind';
import { runBuilds, unitCwd } from '../src/build';
import type { PlannedBuild } from '../src/build';
import { DEFAULT_CONFIG } from '../src/tokens';
import type { Config } from '../src/tokens';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'veren-commander-build-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

const fs = new LocalFileSystem(new Context(), LocalFileSystem.Config({}));
const config: Config = DEFAULT_CONFIG;

/** 在项目根下造一个 npm 单元 / create an npm unit under the root */
function makeNpmUnit(rel: string, manifest: Record<string, unknown>): string {
  const dir = join(root, rel);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
  return rel;
}

describe('planBuild', () => {
  it('classifies a dsh.client package as frontend', async () => {
    const dir = makeNpmUnit('plugins/front', { name: 'front', dsh: { client: { inject: [] } }, scripts: { bundle: 'tsdown' } });
    const plan = await planBuild(fs, root, { dir }, config);
    expect(plan.kind).toBe('frontend');
    expect(plan.command).toBe('npm run bundle');
  });

  it('classifies veren.frontend true as frontend', async () => {
    const dir = makeNpmUnit('plugins/flag', { name: 'flag', veren: { frontend: true } });
    const plan = await planBuild(fs, root, { dir }, config);
    expect(plan.kind).toBe('frontend');
  });

  it('classifies a plain package as backend', async () => {
    const dir = makeNpmUnit('libs/back', { name: 'back' });
    const plan = await planBuild(fs, root, { dir }, config);
    expect(plan.kind).toBe('backend');
    expect(plan.command).toBe('npm run build');
  });

  it('classifies Cargo.toml as rust', async () => {
    const dir = join(root, 'cargos/native');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname = "native"\n');
    const plan = await planBuild(fs, root, { dir: 'cargos/native' }, config);
    expect(plan.kind).toBe('rust');
    expect(plan.command).toBe('cargo build');
  });

  it('falls back when the frontend unit lacks the bundle script', async () => {
    const dir = makeNpmUnit('plugins/nobundle', {
      name: 'nobundle',
      veren: { frontend: true },
      scripts: { build: 'tsc' },
    });
    const plan = await planBuild(fs, root, { dir }, config);
    expect(plan.kind).toBe('frontend');
    expect(plan.command).toBe('npm run build');
  });

  it('throws BUILD_KIND_UNKNOWN without any manifest', async () => {
    mkdirSync(join(root, 'empty'), { recursive: true });
    await expect(planBuild(fs, root, { dir: 'empty' }, config)).rejects.toMatchObject({ code: 'BUILD_KIND_UNKNOWN' });
  });

  it('throws MANIFEST_UNPARSEABLE on a corrupted package.json', async () => {
    const dir = join(root, 'broken');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{ not json');
    await expect(planBuild(fs, root, { dir: 'broken' }, config)).rejects.toMatchObject({ code: 'MANIFEST_UNPARSEABLE' });
  });
});

describe('runBuilds', () => {
  it('runs each plan in order and reports progress', async () => {
    const seen: string[] = [];
    const report = vi.fn();
    const planned: PlannedBuild[] = [
      { name: 'a', plan: { kind: 'backend', command: 'npm run build' }, cwd: unitCwd(root, 'libs/a') },
      { name: 'b', plan: { kind: 'frontend', command: 'npm run bundle' }, cwd: unitCwd(root, 'plugins/b') },
    ];
    await runBuilds(planned, report, async (item) => {
      seen.push(item.name);
    });
    expect(seen).toEqual(['a', 'b']);
    expect(report).toHaveBeenCalledTimes(4); // two build lines + two ok lines
  });

  it('fails fast with BUILD_FAILED on a non-zero exit', async () => {
    const planned: PlannedBuild[] = [
      { name: 'a', plan: { kind: 'backend', command: 'exit 1' }, cwd: root },
      { name: 'b', plan: { kind: 'backend', command: 'true' }, cwd: root },
    ];
    await expect(
      runBuilds(planned, () => {}, async () => {
        throw new CliError('build failed', { code: 'BUILD_FAILED' });
      }),
    ).rejects.toMatchObject({ code: 'BUILD_FAILED' });
  });
});


