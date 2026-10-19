/**
 * @veren/commander-tests —— tests 命令插件：管理隔离的 DSH 训练场。
 *
 * @veren/commander-tests — the tests command plugin: manages isolated DSH
 * training grounds.
 *
 * 遵循本仓库 Provider 约定（同 @veren/commander-list）：
 * Follows this repository's provider convention (same as @veren/commander-list):
 *   - name    插件显示名 / the plugin display name
 *   - inject  依赖的服务令牌 / required service tokens
 *   - Config  用 @deepseek-ai/schemastery 定义的插件配置 schema / the plugin
 *             config schema defined with @deepseek-ai/schemastery
 *   - apply   装配函数：向命令注册表注册 tests 命令 / registers the tests
 *             command with the command registry
 */

import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { getOrThrow } from '@veren/core';
import { Commands } from '@veren/commander-core';
import { Project } from '@veren/commander-project';
import { createTestsCommand } from './commands.js';
import { createDefaultInitializer, startTrainingGround } from './dsh.js';
import { DEFAULT_PROFILE, resolveTrainingPaths } from './ground.js';

export type {
  CreateTrainingGroundOptions,
  CreateTrainingGroundResult,
  RemoveTrainingGroundOptions,
  RemoveTrainingGroundResult,
  StartTrainingGroundOptions,
  TrainingConfig,
  TrainingGroundMeta,
  TrainingGroundRef,
  TrainingGroundSummary,
  TrainingPaths,
} from './ground.js';
export { DEFAULT_PORT, createTestsCommand } from './commands.js';
export {
  MARKER_FILENAME,
  assertSafeTrainingRoot,
  assertTrainingName,
  createTrainingGround,
  listTrainingGrounds,
  readTrainingGround,
  removeTrainingGround,
  resolveTrainingDir,
  resolveTrainingPaths,
} from './ground.js';
export { cleanEnvironment, createDefaultInitializer, runDsh, startTrainingGround } from './dsh.js';

/** 插件显示名 / the plugin display name */
export const name = 'verenCliTestsCommand';

/** 依赖命令注册表与项目服务 / requires the command registry and the project service */
export const inject = [Commands, Project];

/**
 * 插件配置：路径字段留空时按项目根与用户主目录推导。
 * Plugin config: blank path fields are derived from the project root and the
 * user's home directory.
 */
export interface Config {
  /** 训练场根目录；空串使用 <repo>/deepseek/.dsh / training-ground root; blank means <repo>/deepseek/.dsh */
  root: string;
  /** 密钥来源 DSH_HOME；空串使用 ~/.dsh / source DSH home; blank means ~/.dsh */
  sourceHome: string;
  /** DSH 源码目录；空串使用 <repo>/deepseek/deepseek-harness / DSH checkout; blank means <repo>/deepseek/deepseek-harness */
  harnessRoot: string;
  /** 目标 profile；空串使用 web / target profile; blank means web */
  profile: string;
}

/**
 * 插件配置 schema；经 ctx.plugin 装载时校验并补全缺省值。
 * The plugin config schema; ctx.plugin validates it and fills defaults.
 */
export const Config: z<Config> = z.object({
  root: z.string().default(''),
  sourceHome: z.string().default(''),
  harnessRoot: z.string().default(''),
  profile: z.string().default(DEFAULT_PROFILE),
});

/**
 * 插件装配：解析训练场路径，注册 tests 命令；注册 disposer 交还 fiber，
 * 插件卸载时命令自动注销。
 * Plugin assembly: resolves the training-ground paths, registers the tests
 * command, and hands the registration disposer back to the fiber so the
 * command disappears when the plugin unloads.
 */
export const apply = (ctx: Context, config: Config) => {
  const project = getOrThrow(ctx, Project);
  const paths = resolveTrainingPaths(config, project.root);
  const command = createTestsCommand({
    ...paths,
    initProfile: createDefaultInitializer(),
    start: startTrainingGround,
  });
  return getOrThrow(ctx, Commands).register(command);
};
