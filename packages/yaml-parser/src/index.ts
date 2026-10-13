/**
 * @veren/yaml-parser —— YAML 解析 Provider：把 YAML 解析能力以 Cordis 服务提供到上下文。
 *
 * @veren/yaml-parser — the YAML parsing provider: exposes YAML parsing as a
 * Cordis context service.
 *
 * 遵循本仓库 Provider 约定（同 @veren/compiler-* 各包）：
 * Follows this repository's provider convention (same as @veren/compiler-*):
 *   - name    服务令牌 / the service token
 *   - inject  依赖的服务令牌 / required service tokens
 *   - Config  用 @deepseek-ai/schemastery 定义的插件配置 schema / the plugin
 *             config schema defined with @deepseek-ai/schemastery
 *   - apply   装配函数：创建解析服务并提供到上下文 / wires the parser service
 */

import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { defineToken, provide } from '@veren/core';
import { createYamlParser } from './parser.js';
import type { YamlParser } from './tokens.js';
import { name } from './tokens.js';
export type { YamlParser };
export { name }

/** 无依赖的解析服务：不依赖任何其他服务，可最先激活 / dependency-free parser service, activatable first */
export const inject = [];

/**
 * 插件配置 schema：覆盖 yaml 的布尔型 ParseOptions，默认值取 yaml 文档缺省值。
 * 只声明可静态描述的布尔选项；lineCounter、uniqueKeys 比较器等运行时对象
 * 不进入配置（保持配置可声明、可校验）。
 *
 * The plugin config schema: covers yaml's boolean ParseOptions fields with
 * yaml's documented defaults. Only declarative boolean options are exposed;
 * runtime objects (lineCounter, a uniqueKeys comparator) stay out of the
 * config so it remains declarative and validatable.
 */
export const Config = z.object({
  /** 整数解析为 BigInt 而非 number / parse integers into BigInt instead of number */
  intAsBigInt: z.boolean().default(false),
  /** 解析节点上保留 srcToken（CST 令牌）/ keep the srcToken (CST token) on parsed nodes */
  keepSourceTokens: z.boolean().default(false),
  /** 解析错误附带行列位置与节点类型 / include line/col position and node type in parse errors */
  prettyErrors: z.boolean().default(true),
  /** 执行 YAML 1.2 规范要求的错误检测 / enforce errors required by the YAML 1.2 spec */
  strict: z.boolean().default(true),
  /** 所有映射键解析为字符串，非标量键视为错误 / parse all mapping keys as strings; non-scalar keys error */
  stringKeys: z.boolean().default(false),
  /** 映射键必须唯一（按标量值比较）/ map keys must be unique (compared by scalar value) */
  uniqueKeys: z.boolean().default(true),
});

/** 归一化后的插件配置 / the normalized plugin config */
export interface Config {
  /** 整数解析为 BigInt 而非 number / parse integers into BigInt instead of number */
  intAsBigInt: boolean;
  /** 解析节点上保留 srcToken（CST 令牌）/ keep the srcToken (CST token) on parsed nodes */
  keepSourceTokens: boolean;
  /** 解析错误附带行列位置与节点类型 / include line/col position and node type in parse errors */
  prettyErrors: boolean;
  /** 执行 YAML 1.2 规范要求的错误检测 / enforce errors required by the YAML 1.2 spec */
  strict: boolean;
  /** 所有映射键解析为字符串，非标量键视为错误 / parse all mapping keys as strings; non-scalar keys error */
  stringKeys: boolean;
  /** 映射键必须唯一（按标量值比较）/ map keys must be unique (compared by scalar value) */
  uniqueKeys: boolean;
}

/**
 * 创建解析服务并以 name 提供到上下文；返回取消提供的 disposer。
 * config 应先经 Config schema 校验（ctx.plugin 加载时自动完成；直调时传 Config(config)）。
 *
 * Creates the parser service, provides it under name, and returns the
 * unregistering disposer. Validate the config through the Config schema first
 * (automatic via ctx.plugin; call Config(config) for direct invocation).
 */
export const apply = (ctx: Context, config: Config) => {
  return provide(ctx, name, createYamlParser(config));
};
