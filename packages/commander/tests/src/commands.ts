/**
 * tests 命令实现：子命令解析、参数校验与 JSON 输出。
 *
 * The tests command implementation: subcommand parsing, argument validation
 * and JSON output.
 *
 * 命令只依赖最小结构视图（TrainingPaths 与两个注入函数），不感知 Cordis；
 * 插件装配见 ./index.ts 的 apply。
 *
 * The command only depends on a minimal structural view (TrainingPaths plus
 * two injected functions) and knows nothing about Cordis; plugin assembly
 * lives in ./index.ts's apply.
 */

import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { CliError, type CommandDef } from '@veren/commander-core';
import {
  assertSafeTrainingRoot,
  createTrainingGround,
  listTrainingGrounds,
  readTrainingGround,
  removeTrainingGround,
  type CreateTrainingGroundDeps,
  type StartTrainingGroundOptions,
  type TrainingGroundRef,
  type TrainingPaths,
} from './ground.js';

/** 缺省 web 端口 / the default web port */
export const DEFAULT_PORT = 3080;

/** tests 命令依赖 / the tests command dependencies */
export interface TestsCommandDeps extends TrainingPaths {
  /** profile 初始化器 / the profile initializer */
  initProfile: CreateTrainingGroundDeps['initProfile'];
  /** 启动器 / the launcher */
  start(ground: TrainingGroundRef, options: StartTrainingGroundOptions): Promise<void>;
}

/** 解析后的选项 / parsed options */
interface ParsedOptions {
  /** 位置参数 / positional arguments */
  positionals: string[];
  /** 取值的选项 / options with a value */
  values: Map<string, string>;
  /** 布尔开关 / boolean flags */
  flags: Set<string>;
}

/**
 * 创建 tests 命令定义；注册表看到的只有一条命令，子命令由本函数分发。
 * Builds the tests command definition; the registry sees one command and this
 * function dispatches its subcommands.
 */
export function createTestsCommand(deps: TestsCommandDeps): CommandDef {
  return {
    name: 'tests',
    usage: 'tests <create|list|show|path|remove|start> ...',
    summary: '管理隔离的 DSH 训练场：创建时复制密钥与模型配置，测试后可授权清理 / manage isolated DSH training grounds: copy credentials and model configuration on create, clean up with authorization after testing',
    run: (args) => runTests(deps, args),
  };
}

/** 分发表 / the dispatch table */
async function runTests(deps: TestsCommandDeps, args: readonly string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  switch (subcommand) {
    case undefined:
    case 'help':
    case '--help':
    case '-h':
      printHelp();
      return;
    case 'create':
      await createCommand(deps, rest);
      return;
    case 'list':
      await listCommand(deps, rest);
      return;
    case 'show':
      await showCommand(deps, rest);
      return;
    case 'path':
      await pathCommand(deps, rest);
      return;
    case 'remove':
      await removeCommand(deps, rest);
      return;
    case 'start':
      await startCommand(deps, rest);
      return;
    default:
      throw new CliError(
        `未知 tests 子命令 / unknown tests subcommand: ${subcommand}（可用 / available: create, list, show, path, remove, start）`,
        { code: 'TESTS_UNKNOWN_SUBCOMMAND', details: { subcommand } },
      );
  }
}

/** create 子命令 / the create subcommand */
async function createCommand(deps: TestsCommandDeps, args: readonly string[]): Promise<void> {
  const parsed = parseOptions(args, ['from', 'root', 'profile', 'from-profile'], ['dry-run']);
  if (parsed.flags.has('help')) return printHelp();
  const name = requireName(parsed.positionals);
  const root = resolveRoot(deps, parsed);
  const sourceHome = expandUserPath(parsed.values.get('from') ?? deps.sourceHome);
  assertSafeTrainingRoot(root, sourceHome);
  const profile = parsed.values.get('profile') ?? deps.profile;
  const result = await createTrainingGround(
    {
      name,
      root,
      sourceHome,
      harnessRoot: deps.harnessRoot,
      profile,
      sourceProfile: parsed.values.get('from-profile'),
      dryRun: parsed.flags.has('dry-run'),
    },
    { initProfile: deps.initProfile },
  );
  writeJson(result);
}

/** list 子命令 / the list subcommand */
async function listCommand(deps: TestsCommandDeps, args: readonly string[]): Promise<void> {
  const parsed = parseOptions(args, ['root'], []);
  if (parsed.flags.has('help')) return printHelp();
  requireNoName(parsed.positionals);
  const root = resolveRoot(deps, parsed);
  writeJson(await listTrainingGrounds(root));
}

/** show 子命令 / the show subcommand */
async function showCommand(deps: TestsCommandDeps, args: readonly string[]): Promise<void> {
  const parsed = parseOptions(args, ['root'], []);
  if (parsed.flags.has('help')) return printHelp();
  const name = requireName(parsed.positionals);
  const { summary } = await readTrainingGround(resolveRoot(deps, parsed), name);
  writeJson(summary);
}

/** path 子命令：只输出绝对路径，便于脚本 cd / the path subcommand: prints only the absolute path for scripts */
async function pathCommand(deps: TestsCommandDeps, args: readonly string[]): Promise<void> {
  const parsed = parseOptions(args, ['root'], []);
  if (parsed.flags.has('help')) return printHelp();
  const name = requireName(parsed.positionals);
  const { summary } = await readTrainingGround(resolveRoot(deps, parsed), name);
  process.stdout.write(`${summary.path}\n`);
}

/** remove 子命令：必须 --yes 才真正删除 / the remove subcommand: deletion requires --yes */
async function removeCommand(deps: TestsCommandDeps, args: readonly string[]): Promise<void> {
  const parsed = parseOptions(args, ['root'], ['yes', 'force', 'dry-run']);
  if (parsed.flags.has('help')) return printHelp();
  const name = requireName(parsed.positionals);
  const result = await removeTrainingGround({
    root: resolveRoot(deps, parsed),
    name,
    yes: parsed.flags.has('yes'),
    force: parsed.flags.has('force'),
    dryRun: parsed.flags.has('dry-run'),
    currentHome: process.env.DSH_HOME,
  });
  writeJson(result);
}

/** start 子命令：以训练场为 DSH_HOME 启动 dsh web / the start subcommand: boots dsh web with the ground as DSH_HOME */
async function startCommand(deps: TestsCommandDeps, args: readonly string[]): Promise<void> {
  const parsed = parseOptions(args, ['root', 'port'], ['no-open']);
  if (parsed.flags.has('help')) return printHelp();
  const name = requireName(parsed.positionals);
  const { summary, meta } = await readTrainingGround(resolveRoot(deps, parsed), name);
  if (!summary.hasProfile) {
    throw new CliError(
      `训练场 profile 未初始化 / the training ground profile is not initialized: ${summary.path}`,
      { code: 'TRAINING_NOT_INITIALIZED', details: { name, path: summary.path } },
    );
  }
  await deps.start(
    {
      name,
      path: summary.path,
      profile: summary.profile,
      harnessRoot: meta?.harnessRoot ?? deps.harnessRoot,
    },
    { port: parsePort(parsed.values.get('port')), open: !parsed.flags.has('no-open') },
  );
}

/** 解析 --root；缺省用配置值 / resolve --root, falling back to the configured root */
function resolveRoot(deps: TestsCommandDeps, parsed: ParsedOptions): string {
  const rawRoot = parsed.values.get('root');
  const root = rawRoot === undefined ? deps.root : expandUserPath(rawRoot);
  assertSafeTrainingRoot(root, deps.sourceHome);
  return root;
}

/** 解析端口 / parse the port */
function parsePort(value: string | undefined): number {
  if (value === undefined) return DEFAULT_PORT;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new CliError(
      `非法端口 / invalid port: ${value}（期望 1..65535 / expected 1..65535）`,
      { code: 'TESTS_INVALID_PORT', details: { value } },
    );
  }
  return port;
}

/** 要求恰好一个训练场名 / require exactly one training-ground name */
function requireName(positionals: readonly string[]): string {
  if (positionals.length !== 1) {
    throw new CliError(
      `该子命令需要且仅需要一个训练场名 / this subcommand takes exactly one training-ground name（收到 / received: ${positionals.length}）`,
      { code: 'TESTS_INVALID_ARGUMENTS', details: { positionals } },
    );
  }
  return positionals[0];
}

/** 要求没有位置参数 / require no positional arguments */
function requireNoName(positionals: readonly string[]): void {
  if (positionals.length > 0) {
    throw new CliError(
      `该子命令不接受位置参数 / this subcommand takes no positional arguments: ${positionals.join(' ')}`,
      { code: 'TESTS_INVALID_ARGUMENTS', details: { positionals } },
    );
  }
}

/**
 * 解析命令行选项：支持 --key value 与 --key=value，未知选项立即失败。
 * Parses command-line options: supports --key value and --key=value, and
 * rejects unknown options immediately.
 */
function parseOptions(
  args: readonly string[],
  valueOptions: readonly string[],
  flagOptions: readonly string[],
): ParsedOptions {
  const parsed: ParsedOptions = { positionals: [], values: new Map(), flags: new Set() };
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '-h') {
      parsed.flags.add('help');
      continue;
    }
    if (!token.startsWith('--')) {
      parsed.positionals.push(token);
      continue;
    }
    const body = token.slice(2);
    const separator = body.indexOf('=');
    const name = separator === -1 ? body : body.slice(0, separator);
    const inline = separator === -1 ? undefined : body.slice(separator + 1);
    if (name === 'help') {
      parsed.flags.add('help');
      continue;
    }
    if (flagOptions.includes(name)) {
      if (inline !== undefined) throw optionError(`--${name} 不接受取值 / --${name} takes no value`);
      parsed.flags.add(name);
      continue;
    }
    if (!valueOptions.includes(name)) throw optionError(`未知选项 / unknown option: --${name}`);
    const value = inline ?? args[index + 1];
    if (value === undefined || (inline === undefined && value.startsWith('--'))) {
      throw optionError(`选项缺少取值 / option requires a value: --${name}`);
    }
    if (inline === undefined) index += 1;
    parsed.values.set(name, value);
  }
  return parsed;
}

/** 选项错误 / an option error */
function optionError(message: string): CliError {
  return new CliError(`${message}；用 tests help 查看用法 / see tests help for usage`, {
    code: 'TESTS_INVALID_OPTION',
  });
}

/** 展开 ~ 并转为绝对路径 / expand ~ and resolve to an absolute path */
function expandUserPath(value: string): string {
  if (value === '~') return homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) return join(homedir(), value.slice(2));
  return resolve(value);
}

/** 输出稳定 JSON / write stable JSON */
function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/** 打印 tests 子命令帮助 / print the tests subcommand help */
function printHelp(): void {
  process.stdout.write(
    [
      'veren tests — 隔离的 DSH 训练场管理 / isolated DSH training grounds',
      '',
      '用法 / usage:',
      '  veren tests create <name> [--from <home>] [--profile <name>] [--from-profile <name>] [--root <dir>] [--dry-run]',
      '  veren tests list [--root <dir>]',
      '  veren tests show <name> [--root <dir>]',
      '  veren tests path <name> [--root <dir>]',
      '  veren tests remove <name> --yes [--force] [--root <dir>] [--dry-run]',
      '  veren tests start <name> [--port <n>] [--no-open] [--root <dir>]',
      '',
      '说明 / notes:',
      '  create 从 --from（缺省 ~/.dsh）复制 .credentials.yaml、.env、settings.yaml，',
      '  并从源 profile 的 cordis.patch.yml 合并 llm-* 与 agent-default-model 到新训练场。',
      '  训练场根缺省为 <repo>/deepseek/.dsh；每个名字对应一个独立 DSH_HOME。',
      '  remove 必须显式 --yes；未托管目录还需 --force；禁止删除当前 DSH_HOME。',
      '',
      '  create copies .credentials.yaml, .env and settings.yaml from --from (default ~/.dsh),',
      '  then merges llm-* and agent-default-model entries from the source profile patch.',
      '  The root defaults to <repo>/deepseek/.dsh; each name is an independent DSH_HOME.',
      '  remove requires --yes; unmanaged directories also need --force; the active DSH_HOME is protected.',
      '',
    ].join('\n'),
  );
}
