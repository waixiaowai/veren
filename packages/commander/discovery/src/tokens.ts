/**
 * @veren/commander-discovery 的令牌定义：平台无关，可在浏览器或其他环境中使用。
 *
 * Token definitions of @veren/commander-discovery: platform-independent,
 * usable in the browser and elsewhere.
 *
 * 本文件只依赖 @veren/core 的 defineToken —— 不引 Node 内置模块，也不引
 * Cordis —— 因此打包进浏览器 bundle 是安全的；只用令牌、不实现插件的消费方
 * 应从 `@veren/commander-discovery/tokens` 子路径导入。
 *
 * This file only depends on @veren/core's defineToken — no Node built-ins and
 * no Cordis — so bundling it for the browser is safe. Consumers that need only
 * the tokens and not the plugin implementation should import from the
 * `@veren/commander-discovery/tokens` subpath.
 */

import { defineToken } from '@veren/core';

/** 工作区单元（npm 包或 Rust crate）/ one workspace unit (npm package or Rust crate) */
export interface Unit {
  /** 单元名：npm 为 package.json 的 name；Rust 为 [package] name / unit name */
  name: string;
  /** 英文描述：什么情况下使用（见 AGENTS.md 约定）/ English description: when to use it */
  description: string;
  /** 相对项目根的目录位置（/ 分隔）/ directory relative to the project root */
  dir: string;
}

/** Discovery 服务的最小结构化视图（浏览器侧可安全依赖的部分）/ the minimal structural view of the Discovery service (safe to depend on in the browser) */
export interface UnitInventory {
  /** 项目根（单元 dir 的相对基准）/ the project root (what unit dirs are relative to) */
  root: string;
  /** 全部单元，按 dir 排序（输出稳定）；扫描经由注入的文件系统服务，因此为异步 / every unit sorted by dir (stable output); the scan goes through the injected fs service, hence async */
  list(): Promise<Unit[]>;
  /** 按名查找单元；未命中返回 undefined / find one unit by name; undefined on a miss */
  find(name: string): Promise<Unit | undefined>;
  /**
   * 一个子包 dependencies 解析出的单元列表：工作区命中共用清单条目，第三方依赖
   * 从其 node_modules 的 package.json 读取（元数据缺失时 description 为空、dir
   * 指向 node_modules 内约定路径，不保证存在）；未知名返回空数组。
   * A sub-package's dependencies resolved to units: workspace hits reuse the
   * inventory entries, third-party dependencies read their package.json in
   * node_modules (empty description and a conventional, possibly nonexistent
   * node_modules dir when metadata is absent); an empty array on an unknown name.
   */
  listDependencies(name: string): Promise<Unit[]>;
}

/** Discovery 服务令牌，值为 'verenCliDiscovery' / the discovery token; its value is 'verenCliDiscovery' */
export const Discovery = defineToken<UnitInventory>('verenCliDiscovery');
