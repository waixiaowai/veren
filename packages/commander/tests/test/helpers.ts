/**
 * tests 命令测试的共享夹具：真实文件系统 + 假的 profile 初始化器。
 *
 * Shared fixtures for the tests-command suites: a real file system with a
 * fake profile initializer.
 *
 * 每个用例通过 makeWorkspace() 得到独立的临时工作区（源 DSH_HOME 副本 +
 * 训练场根），afterEach 里 removeWorkspace() 统一删除；不触碰 ~/.dsh。
 *
 * Every case gets an isolated temporary workspace (a source DSH_HOME copy plus
 * the training-ground root) from makeWorkspace(), removed again in afterEach
 * via removeWorkspace(); ~/.dsh is never touched.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import type { CreateTrainingGroundDeps, TrainingGroundRef } from '../src/ground';

/** 固定的测试时钟 / the fixed test clock */
const FIXED_NOW = new Date('2026-10-19T00:00:00.000Z');

/** 假初始化器：记录调用次数并写出目标 profile 模板 / fake initializer: counts calls and writes target profile template files */
export interface FakeInitializer {
  /** 已被调用的次数 / how many times init has run */
  readonly callCount: number;
  /** 写出目标 profile 的模板文件 / write the target profile template files */
  init(ground: TrainingGroundRef): Promise<void>;
}

/** 一套完整的测试夹具 / one complete set of fixtures */
export interface WorkspaceFixtures {
  /** 临时工作区根 / the temporary workspace root */
  workspace: string;
  /** 源 DSH_HOME 副本 / the source DSH_HOME copy */
  sourceHome: string;
  /** 训练场根 / the training-ground root */
  root: string;
  /** DSH 源码目录占位 / the DSH checkout placeholder */
  harnessRoot: string;
  /** 假初始化器 / the fake initializer */
  fake: FakeInitializer;
}

/** 创建一套夹具：源 DSH_HOME 副本（密钥/补丁/.npmrc）+ 训练场根 / build one fixture set: a source DSH_HOME copy (credentials/patch/.npmrc) plus the ground root */
export function makeWorkspace(): WorkspaceFixtures {
  const workspace = mkdtempSync(join(tmpdir(), 'veren-tests-command-'));
  const sourceHome = join(workspace, 'source-home');
  const root = join(workspace, 'grounds');
  const harnessRoot = join(workspace, 'harness');
  mkdirSync(sourceHome, { recursive: true });
  writeFileSync(join(sourceHome, '.credentials.yaml'), 'version: 1\nrefs:\n  TEST_API_KEY: secret\n');
  writeFileSync(join(sourceHome, '.env'), 'DEEPSEEK_BASE_URL=https://example.test\n');
  writeFileSync(join(sourceHome, 'settings.yaml'), 'agent-presets:\n  default: cordis\n');
  writeSourceProfileFiles(sourceHome);
  return { workspace, sourceHome, root, harnessRoot, fake: createFakeInitializer() };
}

/** 写源 desktop profile 的补丁与 .npmrc / write the source desktop profile's patch and .npmrc */
function writeSourceProfileFiles(sourceHome: string): void {
  mkdirSync(join(sourceHome, 'profiles', 'desktop'), { recursive: true });
  writeSourcePatch(sourceHome);
  writeSourceNpmrc(sourceHome);
}

/** 写源 profile 的模型补丁（两个模型项 + 一个无关项）/ write the source profile's model patch (two model entries plus one unrelated entry) */
function writeSourcePatch(sourceHome: string): void {
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
}

/** 写源 profile 的 .npmrc（含应被剥离的 store 与安装方式）/ write the source profile's .npmrc (with a store and import method that must be stripped) */
function writeSourceNpmrc(sourceHome: string): void {
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
}

/** 删除整套夹具的工作区 / remove a fixture set's workspace */
export function removeWorkspace(fixtures: WorkspaceFixtures): void {
  rmSync(fixtures.workspace, { recursive: true, force: true });
}

/** 创建假初始化器：计数 + 写出目标 profile 模板文件 / create the fake initializer: counts calls and writes the target profile template files */
export function createFakeInitializer(): FakeInitializer {
  let calls = 0;
  return {
    get callCount() {
      return calls;
    },
    async init(ground: TrainingGroundRef): Promise<void> {
      calls += 1;
      writeProfileTemplate(ground);
    },
  };
}

/** 写目标 profile 的模板文件 / write the target profile's template files */
function writeProfileTemplate(ground: TrainingGroundRef): void {
  const profileDir = join(ground.path, 'profiles', ground.profile);
  mkdirSync(profileDir, { recursive: true });
  writeFileSync(
    join(profileDir, 'package.json'),
    `${JSON.stringify({ name: `dsh-profile-${ground.profile}`, dsh: { profile: { bundles: [] } } }, null, 2)}\n`,
  );
  writeFileSync(join(profileDir, 'cordis.patch.yml'), '[]\n');
}

/** 创建参数 / creation options */
export function createOptions(fixtures: WorkspaceFixtures, name: string): {
  name: string;
  root: string;
  sourceHome: string;
  harnessRoot: string;
  profile: string;
} {
  return { name, root: fixtures.root, sourceHome: fixtures.sourceHome, harnessRoot: fixtures.harnessRoot, profile: 'web' };
}

/** 依赖：假初始化器 + 固定时钟；可显式替换初始化器 / deps: fake initializer + fixed clock; the initializer can be replaced explicitly */
export function createDeps(
  fixtures: WorkspaceFixtures,
  initProfile?: CreateTrainingGroundDeps['initProfile'],
): CreateTrainingGroundDeps {
  return { initProfile: initProfile ?? fixtures.fake.init, now: () => FIXED_NOW };
}

/** 读目标补丁 / read the target patch */
export function targetPatch(root: string, name: string): Array<Record<string, unknown>> {
  const text = readFileSync(join(root, name, 'profiles', 'web', 'cordis.patch.yml'), 'utf8');
  return parse(text) as Array<Record<string, unknown>>;
}
