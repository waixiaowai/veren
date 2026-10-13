/**
 * list 命令实现：JSON 输出全部工作区单元。
 *
 * The list command implementation: prints every workspace unit as JSON.
 *
 * 实现只依赖最小结构化类型 UnitSource（Discovery 服务的 list 视图），不感知
 * Cordis —— 插件装配见 ./index.ts 的 apply。
 *
 * The implementation only depends on the minimal structural type UnitSource
 * (a list view of the Discovery service) and knows nothing about Cordis —
 * plugin assembly lives in ./index.ts's apply.
 */

import z from '@deepseek-ai/schemastery';
import { CliError } from '@veren/commander-core';
import type { DiscoveryService } from '@veren/commander-discovery';

/** list 命令所需的最小单元源 / the minimal unit source the list command needs */
export type UnitSource = Pick<DiscoveryService, 'list'>;

/** JSON 缩进缺省值 / the default JSON indentation */
export const DEFAULT_INDENT = 2;

/** list 归一化配置 / the list's normalized config */
export interface Config {
  /** JSON 缩进空格数 / the number of JSON indentation spaces */
  indent: number;
}

/**
 * 插件配置 schema：indent 为 JSON 输出的缩进空格数。经 ctx.plugin 装载时
 * 自动校验并补全缺省值。
 *
 * The plugin config schema: indent is the number of JSON indentation spaces.
 * Installing via ctx.plugin validates it and fills defaults automatically.
 */
export const Config = z.object({
  indent: z.number().min(0).max(10).default(DEFAULT_INDENT),
});

/** list 实现：独占 stdout 输出 JSON，便于 AI 直接解析 / list impl: own stdout exclusively so AI parsing stays trivial */
export async function cmdList(source: UnitSource, config: Config, args: readonly string[]): Promise<void> {
  if (args.length > 0) {
    throw new CliError('list 不接受参数 / the list command takes no arguments');
  }
  // Discovery.list 是异步扫描 / Discovery.list is an async scan
  process.stdout.write(`${JSON.stringify(await source.list(), null, config.indent)}\n`);
}
