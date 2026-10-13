/**
 * @veren/commander-doc 的令牌定义：平台无关，可在浏览器或其他环境中使用。
 *
 * Token definitions of @veren/commander-doc: platform-independent, usable in
 * the browser and elsewhere.
 *
 * doc 命令本身不提供 Cordis 服务，只向命令注册表注册 `doc` 命令；本文件导出
 * 的配置字段名令牌让平台无关消费方（如 Web 配置面板、远程配置注入）以字符串
 * 常量引用插件配置字段，避免各自硬编码。只依赖 @veren/core 的 defineToken，
 * 不引 Cordis，打包进浏览器 bundle 是安全的。
 *
 * The doc command itself provides no Cordis service; it only registers the
 * `doc` command with the command registry. The config-field-name token below
 * lets platform-agnostic consumers (web config panels, remote config injection)
 * reference the plugin's config fields as string constants instead of
 * hard-coding them. Only @veren/core's defineToken is required — no Cordis —
 * so bundling it for the browser is safe.
 */

import { defineToken } from '@veren/core';

/** 中文优先标志，对应插件配置字段 cnFlags（config：cnFlags）/ the Chinese-preference flags, mapping to the plugin config field cnFlags (config: cnFlags) */
export const CN_FLAGS = defineToken<string[]>('verenCliDocCnFlags');
