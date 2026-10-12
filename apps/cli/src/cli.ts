/**
 * @veren/cli —— veren 项目级元信息 CLI（面向 AI 与开发者）
 * @veren/cli — veren project-level metadata CLI (for AI agents and developers)
 *
 * 命令 / Commands:
 *   list                  列出工作区全部单元（npm 包 / Rust crate），JSON 输出
 *                         list all workspace units (npm packages / Rust crates) as JSON
 *                         输出 / output: [{ name, description, dir }]
 *   doc <name>            输出该单元 README.md 原文（缺失时回退 README.cn.md）
 *                         print the unit's README.md verbatim (falls back to README.cn.md)
 *   doc <name> --cn       输出 README.cn.md 原文（缺失时回退 README.md）
 *                         print README.cn.md verbatim (falls back to README.md)
 *   help                  显示帮助 / show help
 *
 * 配置与单元发现分别见 / config and unit discovery live in:
 *   ./config.ts、./discovery.ts
 *
 * 运行方式 / How to run:
 *   `pnpm cli <command>`（根 package.json 的 cli 脚本代理到本文件）。
 *   `pnpm cli <command>` (the root "cli" script proxies to this file).
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CliError, findProjectRoot, loadConfig, type Config } from './config.ts';
import { discoverUnits, type Unit } from './discovery.ts';

/** 双语文档文件名（遵循 AGENTS.md 约定）/ bilingual doc file names (per AGENTS.md) */
const README_FILES = {
  en: 'README.md',
  cn: 'README.cn.md',
} as const;

/** list：JSON 输出全部单元 / list: print every unit as JSON */
function cmdList(root: string, config: Config): void {
  const units = discoverUnits(root, config);
  // 独占 stdout：除 JSON 外不打印任何修饰内容，方便 AI 直接解析。
  // Own stdout exclusively: print nothing but the JSON so AI parsing stays trivial.
  process.stdout.write(`${JSON.stringify(units, null, 2)}\n`);
}

/**
 * doc：按名定位单元并原文输出其 README；优先语言可指定，缺失时回退另一语言。
 * doc: locate the unit by name and print its README verbatim; the preferred
 * language is selectable, falling back to the other language when missing.
 */
function cmdDoc(root: string, config: Config, name: string, preferCn: boolean): void {
  const unit = locateUnit(root, config, name);

  // 首选语言在前，另一语言兜底 / preferred language first, the other as fallback
  const candidates = preferCn ? [README_FILES.cn, README_FILES.en] : [README_FILES.en, README_FILES.cn];
  for (const file of candidates) {
    const path = join(root, unit.dir, file);
    if (existsSync(path)) {
      // 原样输出，不添加任何修饰 / verbatim output, no decorations
      process.stdout.write(readFileSync(path, 'utf8'));
      return;
    }
  }
  throw new CliError(
    `${unit.dir} 下没有任何 README（约定要求 ${README_FILES.en} 与 ${README_FILES.cn}，见 AGENTS.md）/ no README under ${unit.dir} (the convention requires ${README_FILES.en} and ${README_FILES.cn}, see AGENTS.md)`,
  );
}

/** 按名定位单元；未命中时列出全部可用名 / find one unit by name, listing the available names on a miss */
function locateUnit(root: string, config: Config, name: string): Unit {
  const units = discoverUnits(root, config);
  const unit = units.find((entry) => entry.name === name);
  if (!unit) {
    const names = units.map((entry) => entry.name).join(', ');
    throw new CliError(
      `未找到单元 "${name}"（可用：${names}）/ unit "${name}" not found (available: ${names})`,
    );
  }
  return unit;
}

/** help：双语用法说明 / help: bilingual usage text */
function printHelp(): void {
  process.stdout.write(`veren cli —— 项目级元信息查询 / project-level metadata CLI

用法 / usage:
  pnpm cli list               列出全部单元（JSON）/ list all units (JSON)
  pnpm cli doc <name>         输出 README.md 原文 / print README.md verbatim
  pnpm cli doc <name> --cn    输出 README.cn.md 原文 / print README.cn.md verbatim
  pnpm cli help               显示本帮助 / show this help

配置 / config: .veren.yaml（项目根 / at the project root）
示例 / examples:
  pnpm cli list
  pnpm cli doc @veren/core
  pnpm cli doc veren-core --cn
`);
}

/** 解析 argv 并分发到对应命令 / parse argv and dispatch to a command */
function main(argv: string[]): void {
  const [command, ...rest] = argv;

  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  const root = findProjectRoot();
  const config = loadConfig(root);

  if (command === 'list') {
    cmdList(root, config);
    return;
  }

  if (command === 'doc') {
    // --cn / -c 可出现在任意位置；首个非标志参数即单元名。
    // --cn / -c may appear anywhere; the first non-flag argument is the unit name.
    const preferCn = rest.includes('--cn') || rest.includes('-c');
    const name = rest.find((arg) => arg !== '--cn' && arg !== '-c');
    if (name === undefined) {
      throw new CliError('用法 / usage: pnpm cli doc <name> [--cn]');
    }
    cmdDoc(root, config, name, preferCn);
    return;
  }

  throw new CliError(`未知命令 "${command}"，运行 pnpm cli help 查看用法 / unknown command "${command}"; run pnpm cli help for usage`);
}

try {
  main(process.argv.slice(2));
} catch (error) {
  // 统一错误出口：信息走 stderr，退出码非 0，供 AI 侧识别失败并自纠。
  // Single error exit: message on stderr, non-zero code, so AI callers can detect and self-correct.
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`cli: ${message}\n`);
  process.exitCode = 1;
}
