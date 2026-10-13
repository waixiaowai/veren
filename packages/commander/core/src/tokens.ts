/**
 * @veren/commander-core 的令牌定义：平台无关，可在浏览器或其他环境中使用。
 *
 * Token definitions of @veren/commander-core: platform-independent, usable in
 * the browser and elsewhere.
 *
 * 本文件只依赖 @veren/core 的 defineToken —— 不引 Node 内置模块，也不引
 * Cordis —— 因此打包进浏览器 bundle 是安全的；只用令牌、不实现插件的消费方
 * （例如浏览器内的类型标注或令牌映射）应从 `@veren/commander-core/tokens`
 * 子路径导入，避免把 Cordis 与服务实现拖进 bundle。
 *
 * This file only depends on @veren/core's defineToken — no Node built-ins and
 * no Cordis — so bundling it for the browser is safe. Consumers that need only
 * the tokens and not the plugin implementation (for example in-browser type
 * annotations or token maps) should import from the `@veren/commander-core/
 * tokens` subpath, keeping Cordis and the service implementation out of their
 * bundles.
 */

import { defineToken } from '@veren/core';

/** 一个命令的定义（结构化最小视图）/ the definition of one command (a minimal structural view) */
export interface CommandDefView {
  /** 命令名（argv 首个参数）/ the command name (the first argv token) */
  name: string;
  /** 用法片段（help 列表展示）/ the usage fragment shown in the help listing */
  usage: string;
  /** 双语摘要 / a bilingual one-line summary */
  summary: string;
  /** 执行命令；args 为命令名之后的参数 / runs the command; args are the tokens after the command name */
  run(args: readonly string[]): void | Promise<void>;
}

/**
 * 命令注册表服务接口（结构化最小视图）：命令插件向它 register，消费方从它
 * get/list 并 dispatch —— 纯类型，不含 Cordis 依赖。
 * The command registry service (a minimal structural view): command plugins
 * register into it, consumers get/list/dispatch from it — a pure type with no
 * Cordis dependency.
 */
export interface CommandRegistry {
  /** 注册命令；重名立即报错。返回注销 disposer / registers a command; duplicate names throw; returns an unregistering disposer */
  register(def: CommandDefView): () => void;
  /** 按名查找命令；未命中返回 undefined / look up a command by name; undefined on a miss */
  get(name: string): CommandDefView | undefined;
  /** 全部命令，按名称排序（输出稳定）/ every command sorted by name (stable output) */
  list(): CommandDefView[];
  /** 通用分发：按 argv[0] 路由到已注册命令 / generic dispatch: routes on argv[0] to a registered command */
  dispatch(argv: readonly string[]): Promise<void>;
}

/** 命令注册表服务令牌，值为 'verenCliCommands' / the registry token; its value is 'verenCliCommands' */
export const Commands = defineToken<CommandRegistry>('verenCliCommands');
