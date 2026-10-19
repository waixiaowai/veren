/**
 * tests 命令插件测试：真实文件系统 + 假的 profile 初始化器，不触碰 ~/.dsh。
 *
 * Tests for the tests command plugin: a real file system with a fake profile
 * initializer, and no access to ~/.dsh.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestsCommand } from '../src/commands';
import { cleanEnvironment } from '../src/dsh';
import {
  createTrainingGround,
  listTrainingGrounds,
  readTrainingGround,
  removeTrainingGround,
  resolveTrainingDir,
  resolveTrainingPaths,
  type CreateTrainingGroundDeps,
  type TrainingGroundRef,
} from '../src/ground';

let workspace: string;
let sourceHome: string;
let root: string;
let harnessRoot: string;
let initCalls: number;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'veren-tests-command-'));
  sourceHome = join(workspace, 'source-home');
  root = join(workspace, 'grounds');
  harnessRoot = join(workspace, 'harness');
  initCalls = 0;
  mkdirSync(sourceHome, { recursive: true });
  writeFileSync(join(sourceHome, '.credentials.yaml'), 'version: 1\nrefs:\n  TEST_API_KEY: secret\n');
  writeFileSync(join(sourceHome, '.env'), 'DEEPSEEK_BASE_URL=https://example.test\n');
  writeFileSync(join(sourceHome, 'settings.yaml'), 'agent-presets:\n  default: cordis\n');
  mkdirSync(join(sourceHome, 'profiles', 'desktop'), { recursive: true });
  writeFileSync(
    join(sourceHome, 'profiles', 'desktop', 'cordis.patch.yml'),
    [
      '- id: ui-settings',
      '  name: "@deepseek-ai/dsh-client-ui-settings"',
      '  config:',
      '    enabled: true',
      '- id: llm-pi-ai',
      '  name: "@deepseek-ai/dsh-llm-pi-ai"',
      '  config:',
      '    providers:',
      '      test:',
      '        apiKeyEnv: TEST_API_KEY',
      '        models:',
      '          - id: test-model',
      '- id: agent-default-model',
      '  name: "@deepseek-ai/dsh-agent-default-model"',
      '  config:',
      '    provider: test',
      '    model: test-model',
      '',
    ].join('\n'),
  );
  writeFileSync(
    join(sourceHome, 'profiles', 'desktop', '.npmrc'),
    [
      '@veren:registry=https://npm.veren.top/',
      '//npm.veren.top/:_authToken=registry-token',
      'store-dir=C:/old/store',
      'package-import-method=hardlink',
      '',
    ].join('\n'),
  );
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

/** 假初始化器：写出目标 profile 的模板文件 / fake initializer: writes target profile template files */
async function fakeInit(ground: TrainingGroundRef): Promise<void> {
  initCalls += 1;
  const profileDir = join(ground.path, 'profiles', ground.profile);
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(
    join(profileDir, 'package.json'),
    `${JSON.stringify({ name: `dsh-profile-${ground.profile}`, dsh: { profile: { bundles: [] } } }, null, 2)}\n`,
  );
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n');
}

/** 创建参数 / creation options */
function createOptions(name: string) {
  return { name, root, sourceHome, harnessRoot, profile: 'web' };
}

/** 依赖 / dependencies */
function createDeps(initProfile: CreateTrainingGroundDeps['initProfile'] = fakeInit): CreateTrainingGroundDeps {
  return { initProfile, now: () => new Date('2026-10-19T00:00:00.000Z') };
}

/** 读目标补丁 / read the target patch */
function targetPatch(name: string): Array<Record<string, unknown>> {
  const text = readFileSync(join(root, name, 'profiles', 'web', 'cordis.patch.yml'), 'utf8');
  return parse(text) as Array<Record<string, unknown>>;
}

describe('训练场创建 / training-ground creation', () => {
  it('复制密钥、模型配置并初始化 profile / copies credentials, model configuration and initializes the profile', async () => {
    const result = await createTrainingGround(createOptions('alpha'), createDeps());

    expect(result).toMatchObject({ dryRun: false, name: 'alpha', profile: 'web', sourceProfile: 'desktop' });
    expect(result.copied).toEqual(expect.arrayContaining(['credentials', 'env', 'settings', 'profile-npmrc', 'model-patch:desktop']));
    expect(initCalls).toBe(1);
    expect(readFileSync(join(root, 'alpha', '.credentials.yaml'), 'utf8')).toBe(
      'version: 1\nrefs:\n  TEST_API_KEY: secret\n',
    );
    expect(existsSync(join(root, 'alpha', '.env'))).toBe(true);
    expect(existsSync(join(root, 'alpha', 'settings.yaml'))).toBe(true);

    const patch = targetPatch('alpha');
    expect(patch.map((entry) => entry.id)).toEqual(['llm-pi-ai', 'agent-default-model']);
    expect(patch[0]).toMatchObject({ config: { providers: { test: { apiKeyEnv: 'TEST_API_KEY' } } } });

    const npmrc = readFileSync(join(root, 'alpha', 'profiles', 'web', '.npmrc'), 'utf8');
    expect(npmrc).toContain('package-import-method=copy');
    expect(npmrc).toContain('@veren:registry=https://npm.veren.top/');
    expect(npmrc).toContain('//npm.veren.top/:_authToken=registry-token');
    expect(npmrc).not.toContain('C:/old/store');
    expect(npmrc).toContain(join(root, 'alpha', '.pnpm-store').replaceAll('\\', '/'));

    const meta = JSON.parse(readFileSync(join(root, 'alpha', '.veren-tests.json'), 'utf8')) as Record<string, unknown>;
    expect(meta).toMatchObject({ version: 1, name: 'alpha', sourceProfile: 'desktop', profile: 'web' });
  });

  it('保留目标 profile 已有的非模型补丁项并覆盖同 id 的模型项 / keeps unrelated target entries and replaces same-id model entries', async () => {
    const initProfile = async (ground: TrainingGroundRef): Promise<void> => {
      await fakeInit(ground);
      writeFileSync(
        join(ground.path, 'profiles', ground.profile, 'cordis.patch.yml'),
        [
          '- id: ui-settings-general',
          '  name: "@deepseek-ai/dsh-client-ui-settings-general"',
          '  config:',
          '    welcomeNoticeVersion: old',
          '- id: llm-pi-ai',
          '  name: "@deepseek-ai/dsh-llm-pi-ai"',
          '  config:',
          '    providers:',
          '      old: {}',
          '',
        ].join('\n'),
      );
    };
    await createTrainingGround(createOptions('beta'), createDeps(initProfile));

    const patch = targetPatch('beta');
    expect(patch.map((entry) => entry.id)).toEqual(['ui-settings-general', 'llm-pi-ai', 'agent-default-model']);
    expect(patch[0]).toMatchObject({ config: { welcomeNoticeVersion: 'old' } });
    expect(patch[1]).toMatchObject({ config: { providers: { test: { apiKeyEnv: 'TEST_API_KEY' } } } });
  });

  it('预检不写磁盘 / a dry run writes nothing', async () => {
    const result = await createTrainingGround({ ...createOptions('dry'), dryRun: true }, createDeps());
    expect(result).toMatchObject({ dryRun: true, sourceProfile: 'desktop' });
    expect(existsSync(join(root, 'dry'))).toBe(false);
    expect(initCalls).toBe(0);
  });

  it('初始化失败时清理本次创建的目录 / removes the directory created by a failed run', async () => {
    const failing = async (): Promise<void> => { throw new Error('init failed'); };
    await expect(createTrainingGround(createOptions('broken'), createDeps(failing))).rejects.toThrow('init failed');
    expect(existsSync(join(root, 'broken'))).toBe(false);
  });

  it('拒绝重名与非法名 / rejects duplicates and invalid names', async () => {
    await createTrainingGround(createOptions('alpha'), createDeps());
    await expect(createTrainingGround(createOptions('alpha'), createDeps())).rejects.toMatchObject({
      code: 'TRAINING_EXISTS',
    });
    await expect(createTrainingGround(createOptions('../escape'), createDeps())).rejects.toMatchObject({
      code: 'TRAINING_INVALID_NAME',
    });
    await expect(createTrainingGround(createOptions('con'), createDeps())).rejects.toMatchObject({
      code: 'TRAINING_INVALID_NAME',
    });
  });

  it('缺少源密钥时立即失败 / fails fast when the source has no credentials', async () => {
    rmSync(join(sourceHome, '.credentials.yaml'));
    await expect(createTrainingGround(createOptions('nokey'), createDeps())).rejects.toMatchObject({
      code: 'SOURCE_CREDENTIALS_NOT_FOUND',
    });
    expect(existsSync(join(root, 'nokey'))).toBe(false);
  });
});

describe('训练场发现 / training-ground discovery', () => {
  it('list 与 show 返回托管状态 / list and show report management state', async () => {
    await createTrainingGround(createOptions('alpha'), createDeps());
    mkdirSync(join(root, 'manual'), { recursive: true });

    const listed = await listTrainingGrounds(root);
    expect(listed.map((entry) => [entry.name, entry.managed])).toEqual([
      ['alpha', true],
      ['manual', false],
    ]);
    expect(listed[0]).toMatchObject({ sourceProfile: 'desktop', hasCredentials: true, hasProfile: true });

    const ground = await readTrainingGround(root, 'alpha');
    expect(ground.summary.path).toBe(join(root, 'alpha'));
    expect(ground.meta?.sourceProfile).toBe('desktop');
  });
});

describe('训练场清理 / training-ground removal', () => {
  it('缺少 --yes 时拒绝删除 / refuses removal without --yes', async () => {
    await createTrainingGround(createOptions('alpha'), createDeps());
    await expect(
      removeTrainingGround({ root, name: 'alpha', yes: false, force: false, dryRun: false }),
    ).rejects.toMatchObject({ code: 'TRAINING_AUTHORIZATION_REQUIRED' });
    expect(existsSync(join(root, 'alpha'))).toBe(true);
  });

  it('禁止删除当前 DSH_HOME / refuses to remove the active DSH_HOME', async () => {
    await createTrainingGround(createOptions('alpha'), createDeps());
    await expect(
      removeTrainingGround({
        root,
        name: 'alpha',
        yes: true,
        force: false,
        dryRun: false,
        currentHome: join(root, 'alpha'),
      }),
    ).rejects.toMatchObject({ code: 'TRAINING_IN_USE' });
  });

  it('未托管目录需要 --force / unmanaged directories need --force', async () => {
    mkdirSync(join(root, 'manual'), { recursive: true });
    await expect(
      removeTrainingGround({ root, name: 'manual', yes: true, force: false, dryRun: false }),
    ).rejects.toMatchObject({ code: 'TRAINING_UNMANAGED' });
    await removeTrainingGround({ root, name: 'manual', yes: true, force: true, dryRun: false });
    expect(existsSync(join(root, 'manual'))).toBe(false);
  });

  it('授权后删除托管训练场 / removes a managed ground after authorization', async () => {
    await createTrainingGround(createOptions('alpha'), createDeps());
    const result = await removeTrainingGround({ root, name: 'alpha', yes: true, force: false, dryRun: false });
    expect(result.removed).toBe(true);
    expect(existsSync(join(root, 'alpha'))).toBe(false);
  });
});

describe('命令分发 / command dispatch', () => {
  it('list 输出 JSON，path 输出纯路径，create 支持 dry-run / list prints JSON, path prints a bare path, create supports dry-run', async () => {
    await createTrainingGround(createOptions('alpha'), createDeps());
    const command = createTestsCommand({
      root,
      sourceHome,
      harnessRoot,
      profile: 'web',
      initProfile: fakeInit,
      start: async () => {},
    });
    const output: string[] = [];
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
      output.push(String(chunk));
      return true;
    });
    try {
      await command.run(['list']);
      const listed = JSON.parse(output.join('')) as Array<{ name: string; managed: boolean }>;
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ name: 'alpha', managed: true });

      output.length = 0;
      await command.run(['path', 'alpha']);
      expect(output.join('')).toBe(`${join(root, 'alpha')}\n`);

      output.length = 0;
      await command.run(['create', 'beta', '--dry-run']);
      const created = JSON.parse(output.join('')) as { dryRun: boolean; sourceProfile: string };
      expect(created).toMatchObject({ dryRun: true, sourceProfile: 'desktop' });
      expect(existsSync(join(root, 'beta'))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('未知子命令与多余参数报错 / unknown subcommands and extra arguments fail', async () => {
    const command = createTestsCommand({
      root,
      sourceHome,
      harnessRoot,
      profile: 'web',
      initProfile: fakeInit,
      start: async () => {},
    });
    await expect(command.run(['nope'])).rejects.toMatchObject({ code: 'TESTS_UNKNOWN_SUBCOMMAND' });
    await expect(command.run(['list', 'extra'])).rejects.toMatchObject({ code: 'TESTS_INVALID_ARGUMENTS' });
    await expect(command.run(['list', '--wat'])).rejects.toMatchObject({ code: 'TESTS_INVALID_OPTION' });
  });
});

describe('路径与环境安全 / path and environment safety', () => {
  it('拒绝训练场根与源 DSH_HOME 重叠 / rejects a root overlapping the source DSH home', () => {
    expect(() => resolveTrainingPaths(
      { root: sourceHome, sourceHome, harnessRoot, profile: 'web' },
      workspace,
    )).toThrowError(/overlap/);
    expect(() => resolveTrainingPaths(
      { root: join(sourceHome, 'nested'), sourceHome, harnessRoot, profile: 'web' },
      workspace,
    )).toThrowError(/overlap/);
  });

  it('缺省根是 <repo>/deepseek/.dsh / the default root is <repo>/deepseek/.dsh', () => {
    vi.stubEnv('VEREN_TESTS_ROOT', '');
    try {
      const paths = resolveTrainingPaths(
        { root: '', sourceHome, harnessRoot: '', profile: '' },
        join(workspace, 'repo'),
      );
      expect(paths.root).toBe(join(workspace, 'repo', 'deepseek', '.dsh'));
      expect(paths.profile).toBe('web');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('训练场名始终限制在根下 / a training-ground name stays under the root', () => {
    expect(resolveTrainingDir(root, 'alpha')).toBe(join(root, 'alpha'));
    expect(() => resolveTrainingDir(root, 'a/b')).toThrowError(/invalid training-ground name/);
    expect(() => resolveTrainingDir(root, '.hidden')).toThrowError(/invalid training-ground name/);
  });

  it('清理环境剥掉 DSH_* 与疑似密钥 / the cleaned environment strips DSH_* and secret-looking names', () => {
    const cleaned = cleanEnvironment({
      PATH: '/bin',
      DSH_HOME: '/home/.dsh',
      DSh_TEST: '1',
      DEEPSEEK_API_KEY: 'secret',
      TOKENAV_API_KEY: 'secret',
      SAFE_VALUE: 'ok',
    });
    expect(cleaned).toEqual({ PATH: '/bin', SAFE_VALUE: 'ok' });
  });
});
