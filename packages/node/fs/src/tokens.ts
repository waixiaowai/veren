import { defineToken } from '@veren/core';

/**
 * Node 文件系统服务接口：fs/promises 常用能力的可替换子集。
 * The Node filesystem service interface: a swappable subset of the common
 * fs/promises capabilities.
 */
export interface NodeFs {
  /**
   * 读取文件内容为文本（使用服务配置的默认编码）。
   * Reads a file's content as text (using the service's configured encoding).
   */
  readFile(path: string, encoding?: BufferEncoding): Promise<string>;

  /**
   * 将文本写入文件（整体覆盖）。
   * Writes text to a file (full overwrite).
   */
  writeFile(path: string, data: string, encoding?: BufferEncoding): Promise<void>;

  /**
   * 向文件末尾追加文本，文件不存在时创建。
   * Appends text to a file, creating it when missing.
   */
  appendFile(path: string, data: string, encoding?: BufferEncoding): Promise<void>;

  /**
   * 判断路径是否存在（基于 access，不抛错）。
   * Whether a path exists (access-based, never throws).
   */
  exists(path: string): Promise<boolean>;

  /**
   * 获取路径的 stat 信息。
   * Reads the stat of a path.
   */
  stat(path: string): Promise<import('node:fs').Stats>;

  /**
   * 创建目录，recursive 时逐级创建且已存在不报错。
   * Creates a directory; with recursive, missing parents are created and an
   * existing directory is not an error.
   */
  mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>;

  /**
   * 读取目录项名称列表。
   * Lists the entry names of a directory.
   */
  readdir(path: string): Promise<string[]>;

  /**
   * 删除文件或目录（recursive 时可删非空目录）。
   * Removes a file or directory (non-empty directories with recursive).
   */
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;

  /**
   * 重命名（移动）文件或目录。
   * Renames (moves) a file or directory.
   */
  rename(oldPath: string, newPath: string): Promise<void>;

  /**
   * 复制文件。
   * Copies a file.
   */
  copyFile(src: string, dest: string): Promise<void>;
}

/** Node 文件系统服务令牌 / the Node filesystem service token */
export const verenNodeFs = defineToken<NodeFs>('verenNodeFs');
