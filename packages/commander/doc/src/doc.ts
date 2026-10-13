/**
 * doc 命令实现：原文输出单元的双语 README。
 * The doc command implementation: prints a unit's bilingual README verbatim.
 *
 * 实现只依赖最小结构化类型 UnitSource（Discovery 服务的 find/list/root 视图）
 * 与 @veren/node-fs、@veren/node-path 注入的服务，不感知 Cordis ——
 * 插件装配见 ./index.ts 的 apply。
 * The implementation only depends on the minimal structural type UnitSource
 * (a find/list/root view of the Discovery service) plus the services injected
 * from @veren/node-fs and @veren/node-path, and knows nothing about Cordis —
 * plugin assembly lives in ./index.ts's apply.
 */

import z from '@deepseek-ai/schemastery';
import { CliError } from '@veren/commander-core';
import type { DiscoveryService, Unit } from '@veren/commander-discovery';
import type { NodeFs } from '@veren/node-fs';
import type { NodePath } from '@veren/node-path';

/** doc 命令所需的最小单元源 / the minimal unit source the doc command needs */
export type UnitSource = Pick<DiscoveryService, 'find' | 'list' | 'root'>;

/** 中文优先标志缺省值 / the default Chinese-preference flags */
export const DEFAULT_CN_FLAGS: readonly string[] = ['--cn', '-c'];

/** doc 归一化配置 / the doc's normalized config */
export interface Config {
  /** 触发中文优先的 argv 标志 / the argv flags that prefer Chinese */
  cnFlags: string[];
}

/**
 * 插件配置 schema：cnFlags 为触发中文优先的 argv 标志。经 ctx.plugin 装载时
 * 自动校验并补全缺省值。
 * The plugin config schema: cnFlags are the argv flags that prefer Chinese.
 * Installing via ctx.plugin validates it and fills defaults automatically.
 */
export const Config = z.object({
  cnFlags: z.array(z.string()).default([...DEFAULT_CN_FLAGS]),
});

/** 双语文档文件名（遵循 AGENTS.md 约定）/ bilingual doc file names (per AGENTS.md) */
const README_FILES = {
  en: 'README.md',
  cn: 'README.cn.md',
} as const;

/**
 * doc 实现：中文标志可出现在任意位置，首个非标志参数即单元名；
 * 首选语言在前，另一语言兜底；stdout 原样输出，不加任何修饰。
 * doc impl: the Chinese flags may appear anywhere, the first non-flag argument
 * is the unit name; the preferred language comes first, the other one as
 * fallback; output goes to stdout verbatim, no decorations.
 */
export async function cmdDoc(
  source: UnitSource,
  config: Config,
  args: readonly string[],
  fs: NodeFs,
  path: NodePath,
): Promise<void> {
  const preferCn = args.some((arg) => config.cnFlags.includes(arg));
  const name = args.find((arg) => !config.cnFlags.includes(arg));
  if (name === undefined) {
    throw new CliError('用法 / usage: pnpm cli doc <name> [--cn]');
  }
  const unit = await locateUnit(source, name);
  const candidates = preferCn ? [README_FILES.cn, README_FILES.en] : [README_FILES.en, README_FILES.cn];
  for (const file of candidates) {
    const readme = path.join(source.root, unit.dir, file);
    if (await fs.exists(readme)) {
      // 原样输出，不添加任何修饰 / verbatim output, no decorations
      process.stdout.write(await fs.readFile(readme));
      return;
    }
  }
  throw new CliError(
    `${unit.dir} 下没有任何 README（约定要求 ${README_FILES.en} 与 ${README_FILES.cn}，见 AGENTS.md）/ no README under ${unit.dir} (the convention requires ${README_FILES.en} and ${README_FILES.cn}, see AGENTS.md)`,
  );
}

/** 按名定位单元；未命中时列出全部可用名 / find one unit by name, listing the available names on a miss */
export async function locateUnit(source: UnitSource, name: string): Promise<Unit> {
  const unit = await source.find(name);
  if (!unit) {
    const names = (await source.list()).map((entry) => entry.name).join(', ');
    throw new CliError(
      `未找到单元 "${name}"（可用：${names}）/ unit "${name}" not found (available: ${names})`,
    );
  }
  return unit;
}
