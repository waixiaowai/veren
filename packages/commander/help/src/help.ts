/**
 * help 命令实现：从命令注册表生成双语用法说明。
 *
 * The help command implementation: renders the bilingual usage listing from
 * the command registry.
 *
 * 实现只依赖最小结构化类型（注册表的 list 视图），不感知 Cordis ——
 * 插件装配见 ./index.ts 的 apply。
 *
 * The implementation only depends on the minimal structural type (a list view
 * of the registry) and knows nothing about Cordis — plugin assembly lives in
 * ./index.ts's apply.
 */

import z from '@deepseek-ai/schemastery';
import type { CommandRegistry } from '@veren/commander-core';

/** 用法行展示的程序名缺省值 / the default program name shown on usage rows */
export const DEFAULT_PROGRAM = 'pnpm cli';

/** help 归一化配置 / the help's normalized config */
export interface Config {
  /** 用法行展示的程序名 / the program name shown on usage rows */
  program: string;
}

/**
 * 插件配置 schema：program 为用法行展示的程序名。经 ctx.plugin 装载时自动
 * 校验并补全缺省值。
 *
 * The plugin config schema: program is the program name shown on usage rows.
 * Installing via ctx.plugin validates it and fills defaults automatically.
 */
export const Config: z<Config> = z.object({
  program: z.string().default(DEFAULT_PROGRAM),
});

/** help 实现：用法列表完全由已注册命令生成 / help impl: the usage list is generated entirely from registered commands */
export function printUsage(commands: CommandRegistry, config: Config): void {
  const rows = commands
    .list()
    .map((command) => `  ${config.program} ${command.usage}`.padEnd(30) + command.summary)
    .join('\n');
  process.stdout.write(
    `veren cli —— 项目级元信息查询 / project-level metadata CLI\n\n用法 / usage:\n${rows}\n\n配置 / config: .veren.yaml（项目根 / at the project root）\n`,
  );
}
