/**
 * tests 子命令的命令行选项解析与位置参数校验。
 *
 * Command-line option parsing and positional-argument validation for the
 * tests subcommands.
 *
 * 只支持本命令用到的形状：`--key value` 与 `--key=value` 两种取值写法、
 * 无值开关、`-h`/`--help` 帮助开关；未知选项立即失败，保证拼写错误不会被
 * 静默吞掉。
 *
 * Only the shapes this command needs: `--key value` and `--key=value` for
 * valued options, valueless switches, and the `-h`/`--help` flag. Unknown
 * options fail immediately so typos are never swallowed silently.
 */

import { CliError } from '@veren/commander-core';

/** 解析后的选项 / parsed options */
export interface ParsedOptions {
  /** 位置参数 / positional arguments */
  positionals: string[];
  /** 取值的选项 / options with a value */
  values: Map<string, string>;
  /** 布尔开关 / boolean flags */
  flags: Set<string>;
}

/**
 * 解析命令行选项：支持 --key value 与 --key=value，未知选项立即失败。
 * Parses command-line options: supports --key value and --key=value, and
 * rejects unknown options immediately.
 */
export function parseOptions(
  args: readonly string[],
  valueOptions: readonly string[],
  flagOptions: readonly string[],
): ParsedOptions {
  const parsed: ParsedOptions = { positionals: [], values: new Map(), flags: new Set() };
  for (let index = 0; index < args.length; index += 1) {
    index = consumeToken(args, index, parsed, valueOptions, flagOptions);
  }
  return parsed;
}

/**
 * 消费一个 token，返回下一次循环应从哪个下标继续。
 * Consumes one token and returns the index the loop should continue from.
 */
function consumeToken(
  args: readonly string[],
  index: number,
  parsed: ParsedOptions,
  valueOptions: readonly string[],
  flagOptions: readonly string[],
): number {
  const token = args[index];
  if (token === '-h') {
    parsed.flags.add('help');
    return index;
  }
  if (!token.startsWith('--')) {
    parsed.positionals.push(token);
    return index;
  }
  return consumeOption(args, index, parsed, valueOptions, flagOptions);
}

/** 消费一个 `--` 开头的选项 token / consume one `--`-prefixed option token */
function consumeOption(
  args: readonly string[],
  index: number,
  parsed: ParsedOptions,
  valueOptions: readonly string[],
  flagOptions: readonly string[],
): number {
  const body = args[index].slice(2);
  const separator = body.indexOf('=');
  const name = separator === -1 ? body : body.slice(0, separator);
  const inline = separator === -1 ? undefined : body.slice(separator + 1);
  if (name === 'help') {
    parsed.flags.add('help');
    return index;
  }
  if (flagOptions.includes(name)) {
    if (inline !== undefined) throw optionError(`--${name} 不接受取值 / --${name} takes no value`);
    parsed.flags.add(name);
    return index;
  }
  if (!valueOptions.includes(name)) throw optionError(`未知选项 / unknown option: --${name}`);
  return consumeValue(args, index, parsed, name, inline);
}

/** 消费一个取值选项；内联取值原地记录，分离取值再前进一个下标 / consume one valued option; inline values are recorded in place, separated values advance one more index */
function consumeValue(
  args: readonly string[],
  index: number,
  parsed: ParsedOptions,
  name: string,
  inline: string | undefined,
): number {
  const value = inline ?? args[index + 1];
  if (value === undefined || (inline === undefined && value.startsWith('--'))) {
    throw optionError(`选项缺少取值 / option requires a value: --${name}`);
  }
  parsed.values.set(name, value);
  return inline === undefined ? index + 1 : index;
}

/** 选项错误 / an option error */
function optionError(message: string): CliError {
  return new CliError(`${message}；用 tests help 查看用法 / see tests help for usage`, {
    code: 'TESTS_INVALID_OPTION',
  });
}

/** 要求恰好一个训练场名 / require exactly one training-ground name */
export function requireName(positionals: readonly string[]): string {
  if (positionals.length !== 1) {
    throw new CliError(
      `该子命令需要且仅需要一个训练场名 / this subcommand takes exactly one training-ground name（收到 / received: ${positionals.length}）`,
      { code: 'TESTS_INVALID_ARGUMENTS', details: { positionals } },
    );
  }
  return positionals[0];
}

/** 要求没有位置参数 / require no positional arguments */
export function requireNoName(positionals: readonly string[]): void {
  if (positionals.length > 0) {
    throw new CliError(
      `该子命令不接受位置参数 / this subcommand takes no positional arguments: ${positionals.join(' ')}`,
      { code: 'TESTS_INVALID_ARGUMENTS', details: { positionals } },
    );
  }
}
