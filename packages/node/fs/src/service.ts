/**
 * Node 文件系统服务：把 fs/promises 的常用能力收拢为一个纯服务对象。
 * The Node filesystem service: gathers common fs/promises capabilities into
 * a plain service object.
 *
 * 服务本身不感知 Cordis：它只是一个可替换的实现，
 * 由 ./index.ts 的 Provider 装配进上下文。
 * The service itself is Cordis-agnostic: it is a swappable implementation,
 * wired into the context by the provider in ./index.ts.
 */

import * as fsp from 'node:fs/promises';
import type { NodeFs } from './tokens.js';

/** 服务的创建选项 / options used to create the service */
export interface NodeFsOptions {
  /** 读写文本的默认编码 / the default encoding for reading and writing text */
  encoding: BufferEncoding;
}

/**
 * 创建基于 fs/promises 的文件系统服务；options.encoding 作为未显式指定编码时的默认值。
 * Creates the fs/promises-backed service; options.encoding becomes the default
 * when a call does not pass an encoding explicitly.
 */
export function createNodeFs(options: NodeFsOptions): NodeFs {
  return {
    readFile(path, encoding) {
      return fsp.readFile(path, encoding ?? options.encoding);
    },
    writeFile(path, data, encoding) {
      return fsp.writeFile(path, data, encoding ?? options.encoding).then(() => undefined);
    },
    appendFile(path, data, encoding) {
      return fsp.appendFile(path, data, encoding ?? options.encoding).then(() => undefined);
    },
    exists(path) {
      // access 成功即存在；ENOENT 等错误统一视为不存在。
      // A successful access means it exists; any error (ENOENT etc.) means not.
      return fsp
        .access(path)
        .then(() => true)
        .catch(() => false);
    },
    stat(path) {
      return fsp.stat(path);
    },
    mkdir(path, options) {
      return fsp.mkdir(path, options);
    },
    readdir(path) {
      return fsp.readdir(path);
    },
    rm(path, options) {
      return fsp.rm(path, options).then(() => undefined);
    },
    rename(oldPath, newPath) {
      return fsp.rename(oldPath, newPath).then(() => undefined);
    },
    copyFile(src, dest) {
      return fsp.copyFile(src, dest).then(() => undefined);
    },
  };
}
