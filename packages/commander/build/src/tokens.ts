/**
 * @veren/commander-build 的令牌与配置：构建分型、构建计划与插件配置 schema。
 *
 * Tokens and config of @veren/commander-build: build kinds, build plans and
 * the plugin config schema.
 *
 * Config schema 需要 schemastery（与 list 等命令插件一致），因此本文件引入
 * @deepseek-ai/schemastery；构建分型与计划为纯类型。
 * The Config schema needs schemastery (like the list command plugin), so this
 * file imports @deepseek-ai/schemastery; build kinds and plans are pure types.
 */

import z from '@deepseek-ai/schemastery';

/** 构建分型：前端插件（浏览器 bundle）/ 后端插件（tsc 类发布）/ Rust crate（cargo） / the build kind */
export type BuildKind = 'frontend' | 'backend' | 'rust';

/** 一个单元的构建计划：分型与实际要执行的命令 / the build plan of one unit: its kind and the command to run */
export interface BuildPlan {
  /** 构建分类 / the detected build kind */
  kind: BuildKind;
  /** 在单元目录下执行的命令（shell 字符串） / the command to run in the unit directory (a shell string) */
  command: string;
}

/** 构建配置：各分型的命令与前端回退命令 / the build config: per-kind commands and the frontend fallback */
export interface Config {
  /** 后端插件命令 / the backend plugin command */
  backendCommand: string;
  /** 前端插件命令 / the frontend plugin command */
  frontendCommand: string;
  /** 前端单元缺该脚本时的回退命令 / the frontend fallback when the unit lacks the configured script */
  frontendFallbackCommand: string;
  /** Rust crate 命令 / the Rust crate command */
  rustCommand: string;
}

/** 各命令缺省值 / the per-kind command defaults */
export const DEFAULT_CONFIG: Config = {
  backendCommand: 'npm run build',
  frontendCommand: 'npm run bundle',
  frontendFallbackCommand: 'npm run build',
  rustCommand: 'cargo build',
};

/**
 * 插件配置 schema：各分型命令均可覆盖。经 ctx.plugin 装载时自动校验并补全
 * 缺省值。
 *
 * The plugin config schema: every per-kind command is overridable. Installing
 * via ctx.plugin validates it and fills defaults automatically.
 */
export const Config: z<Config> = z.object({
  backendCommand: z.string().default(DEFAULT_CONFIG.backendCommand),
  frontendCommand: z.string().default(DEFAULT_CONFIG.frontendCommand),
  frontendFallbackCommand: z.string().default(DEFAULT_CONFIG.frontendFallbackCommand),
  rustCommand: z.string().default(DEFAULT_CONFIG.rustCommand),
});
