/**
 * CLI 命令扩展契约：命令注册表服务、命令定义、归一化配置与统一错误类型。
 *
 * The CLI command extension contract: the command registry service, the
 * command definition shape, the normalized config, and the unified error type.
 *
 * 「一切皆插件」：命令由插件提供 —— 插件在 apply 中向本服务 register 自己；
 * 注册表本身也是插件（装配见 ./index.ts 的 apply），由组装入口装载。
 *
 * "Everything is a plugin": commands come from plugins — a plugin registers
 * itself with this service in its apply; the registry itself is a plugin too
 * (assembly lives in ./index.ts's apply), installed by the composition entry.
 */
import z from '@deepseek-ai/schemastery';
import type { Context } from '@deepseek-ai/cordis';
import { Service } from '@deepseek-ai/cordis';

// 命令注册表令牌定义在平台无关的 ./tokens.ts（浏览器等环境可单独导入），
// 这里本地使用并再导出以保持包 API 稳定。
// The registry token is defined in the platform-independent ./tokens.ts
// (importable alone in the browser, etc.); it is used here and re-exported to
// keep the package's API stable.
import { Commands } from './tokens.js';
export { Commands } from './tokens.js';

/** 命令框架统一错误：双语消息，经 main 走 stderr 并以非零码退出。
 *  The commander's unified error: a bilingual message that main prints on
 *  stderr with a non-zero exit code. */
export class CliError extends Error { }

/** 一个命令的定义 / the definition of one command */
export interface CommandDef {
  /** 命令名（argv 首个参数）/ the command name (the first argv token) */
  name: string;
  /** 用法片段（help 列表展示）/ the usage fragment shown in the help listing */
  usage: string;
  /** 双语摘要 / a bilingual one-line summary */
  summary: string;
  /**
   * 执行命令；args 为命令名之后的参数，由命令自行解析。
   * Runs the command; args are the tokens after the command name, parsed by
   * the command itself.
   */
  run(args: readonly string[]): void | Promise<void>;
}

/** 注册表归一化配置 / the registry's normalized config */
export interface Config {
  /**
   * 触发 help 的 argv 标志：dispatch 命中任一标志即路由到 help 命令。
   * The argv flags that trigger help: dispatch routes any of them to the
   * help command.
   */
  helpFlags: string[];
}

/**
 * helpFlags 缺省值：Config schema 与直接构造 CommandService 共用。
 * 必须先于 Config schema 声明，避免模块求值时的暂时性死区。
 * The helpFlags default: shared by the Config schema and direct
 * CommandService construction. It must be declared before the Config schema
 * to avoid a temporal dead zone at module evaluation time.
 */
export const DEFAULT_HELP_FLAGS: readonly string[] = ['--help', '-h'];

/**
 * 插件配置 schema：helpFlags 为触发 help 的 argv 标志，dispatch 读取
 * 注册表实例上的归一化结果。经 ctx.plugin 装载时自动校验并补全缺省值。
 *
 * The plugin config schema: helpFlags are the argv flags that trigger help,
 * read by dispatch from the registry instance's normalized value. Installing
 * via ctx.plugin validates it and fills defaults automatically.
 */
export const Config = z.object({
  helpFlags: z.array(z.string()).default([...DEFAULT_HELP_FLAGS]),
});

/**
 * 命令注册表：命令插件向它注册，分发器从它查找。
 * 构造时即以 Commands 令牌注册为服务，并随装载它的 fiber 卸载自动注销。
 *
 * The command registry: command plugins register into it, the dispatcher
 * looks commands up in it. Constructing registers the service under the
 * Commands token; it unregisters automatically when its fiber unloads.
 */
export class CommandService extends Service {
  private readonly _commands = new Map<string, CommandDef>();

  /** 本实例的归一化配置 / the normalized config of this instance */
  readonly config: Config;

  constructor(
    ctx: Context,
    config: Config = { helpFlags: [...DEFAULT_HELP_FLAGS] },
  ) {
    super(ctx, Commands);
    this.config = config;
  }

  /**
   * 注册命令；重名立即报错。返回注销 disposer —— 插件把它返回给 fiber，
   * 插件卸载时注册自动失效。
   * Registers a command; duplicate names throw immediately. Returns an
   * unregistering disposer — hand it back to the fiber so the registration
   * disappears when the plugin unloads.
   */
  register(def: CommandDef): () => void {
    if (this._commands.has(def.name)) {
      throw new Error(`命令 "${def.name}" 已注册 / command "${def.name}" is already registered`);
    }
    this._commands.set(def.name, def);
    return () => {
      if (this._commands.get(def.name) === def) this._commands.delete(def.name);
    };
  }

  /** 按名查找；未命中返回 undefined / look up by name; undefined on a miss */
  get(name: string): CommandDef | undefined {
    return this._commands.get(name);
  }

  /** 全部命令，按名称排序（输出稳定）/ every command sorted by name (stable output) */
  list(): CommandDef[] {
    return [...this._commands.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  /**
   * 通用分发：argv[0] 为命令名，其余参数交由命令自行解析；
   * 无参数或命中 helpFlags 时路由到 help，未知命令报错并列出可用命令。
   * Generic dispatch: argv[0] names the command, the rest goes to the command
   * itself; no arguments or any helpFlag routes to help, unknown commands
   * throw with the available names.
   */
  async dispatch(argv: readonly string[]): Promise<void> {
    const [first, ...rest] = argv;
    const name = !first || this.config.helpFlags.includes(first) ? 'help' : first;
    const command = this.get(name);
    if (!command) {
      const available = this.list().map((entry) => entry.name).join(', ');
      throw new CliError(
        `未知命令 "${name}"（可用：${available}）/ unknown command "${name}" (available: ${available})`,
      );
    }
    await command.run(rest);
  }
}
