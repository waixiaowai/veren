import { defineToken } from '@veren/core';

/**
 * Node 路径服务接口：node:path 常用纯函数的可替换子集。
 * The Node path service interface: a swappable subset of the common pure
 * functions of node:path.
 */
export interface NodePath {
  /** 拼接路径片段 / joins path segments */
  join(...segments: string[]): string;
  /** 解析为绝对路径 / resolves to an absolute path */
  resolve(...segments: string[]): string;
  /** 返回目录部分 / returns the directory portion */
  dirname(path: string): string;
  /** 返回文件名部分 / returns the last segment */
  basename(path: string, ext?: string): string;
  /** 返回扩展名（含点）/ returns the extension (dot included) */
  extname(path: string): string;
  /** 计算 from 到 to 的相对路径 / computes the relative path from → to */
  relative(from: string, to: string): string;
  /** 规范化路径 / normalizes a path */
  normalize(path: string): string;
  /** 判断是否绝对路径 / whether the path is absolute */
  isAbsolute(path: string): boolean;
  /** 路径分隔符（/ 或 \）/ the path separator (/ or \) */
  readonly sep: string;
  /** PATH 环境变量分隔符（: 或 ;）/ the PATH env delimiter (: or ;) */
  readonly delimiter: string;
}

/** Node 路径服务令牌 / the Node path service token */
export const verenNodePath = defineToken<NodePath>('verenNodePath');
