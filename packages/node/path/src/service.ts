/**
 * Node 路径服务：把 node:path 的常用纯函数按目标平台收拢为一个纯服务对象。
 * The Node path service: gathers the common pure functions of node:path for a
 * target platform into a plain service object.
 *
 * 服务本身不感知 Cordis：它只是一个可替换的实现，
 * 由 ./index.ts 的 Provider 装配进上下文。
 * The service itself is Cordis-agnostic: it is a swappable implementation,
 * wired into the context by the provider in ./index.ts.
 */

import * as nodePath from 'node:path';
import type { NodePath } from './tokens.js';

/** 服务的创建选项 / options used to create the service */
export interface NodePathOptions {
  /** 使用哪一套路径风格 / which path flavor to delegate to */
  platform: 'posix' | 'win32';
}

/**
 * 创建基于 node:path 的路径服务；platform 决定委托给 posix 还是 win32 实现。
 * Creates the node:path-backed service; platform selects the posix or win32
 * implementation to delegate to.
 */
export function createNodePath(options: NodePathOptions): NodePath {
  // impl 是 node:path 的某一平台实现，方法签名与 NodePath 完全一致。
  // impl is one platform flavor of node:path whose methods match NodePath.
  const impl: typeof nodePath.posix =
    options.platform === 'win32' ? nodePath.win32 : nodePath.posix;
  return {
    join: (...segments) => impl.join(...segments),
    resolve: (...segments) => impl.resolve(...segments),
    dirname: (path) => impl.dirname(path),
    basename: (path, ext) => impl.basename(path, ext),
    extname: (path) => impl.extname(path),
    relative: (from, to) => impl.relative(from, to),
    normalize: (path) => impl.normalize(path),
    isAbsolute: (path) => impl.isAbsolute(path),
    sep: impl.sep,
    delimiter: impl.delimiter,
  };
}
