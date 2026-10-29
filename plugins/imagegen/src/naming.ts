/**
 * 非破坏性命名：落盘路径永不覆盖既有文件——重名时派生 `-v2` 兄弟名。
 * 移植自生料 SKILL.md 的保存路径政策（"create a sibling versioned filename"）。
 * Non-destructive naming: a save path never overwrites an existing file — on
 * collision a `-v2` sibling name is derived. Ported from the raw material's
 * save-path policy ("create a sibling versioned filename").
 *
 * @module @veren/imagegen
 */
import { existsSync } from 'node:fs'
import { extname, join, dirname } from 'node:path'

/**
 * 解析不冲突的落盘绝对路径：`hero.png` 存在时依次尝试 `hero-v2.png`、
 * `hero-v3.png`…目录不存在时原样返回（写盘前统一建目录）。
 * Resolves a collision-free absolute save path: when `hero.png` exists, tries
 * `hero-v2.png`, `hero-v3.png`… in order; a missing directory returns as-is
 * (directories are created once before writing).
 * @param requested - 请求的绝对路径。The requested absolute path.
 * @returns 第一个不存在的路径。The first nonexistent path.
 */
export function avoidCollision(requested: string): string {
  if (!existsSync(requested)) return requested
  const ext = extname(requested)
  const stem = requested.slice(0, requested.length - ext.length)
  for (let version = 2; ; version += 1) {
    const candidate = `${stem}-v${version}${ext}`
    if (!existsSync(candidate)) return candidate
  }
}

/**
 * 在基准目录下组装默认落盘路径：`imagegen/<slug>-<序号>.png` 形态由调用方
 * 传入文件名，这里只负责目录拼接。
 * Assembles the default save path under a base directory; the caller supplies
 * the file name, this only joins the directory.
 * @param baseDir - 工作区基准目录。The workspace base directory.
 * @param fileName - 形如 `imagegen/hero.png` 的相对名。A relative name like `imagegen/hero.png`.
 * @returns 绝对路径。The absolute path.
 */
export function underBase(baseDir: string, fileName: string): string {
  return join(baseDir, fileName)
}

/** 输出文件所在目录（写盘前 mkdir 用）。The output file's directory (for mkdir before writing). */
export function directoryOf(filePath: string): string {
  return dirname(filePath)
}
