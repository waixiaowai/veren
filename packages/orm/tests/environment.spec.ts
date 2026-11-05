import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** 包根目录。 / Package root. */
const ROOT = fileURLToPath(new URL('..', import.meta.url))
/** 唯一允许触碰 Node 内建的适配器：其余源码必须环境无关。 / The only adapter allowed to touch a Node built-in; everything else must stay environment-agnostic. */
const NODE_ALLOWED = new Set(['driver/node-sqlite-client.ts'])

/** 递归收集 src 下的 TypeScript 文件。 / Collect every TypeScript file under src. */
function sourceFiles(directory: string, found: string[] = []): string[] {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) sourceFiles(path, found)
    else if (entry.isFile() && entry.name.endsWith('.ts')) found.push(path)
  }
  return found
}

/** 去掉类型-only import 与注释后检查运行时 Node 依赖。 / Check runtime Node dependencies after dropping type-only imports and comments. */
function runtimeNodeImports(source: string): boolean {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
  return /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]node:/.test(withoutComments)
}

describe('environment agnosticism', () => {
  it('keeps Node built-ins confined to the node:sqlite adapter', () => {
    const offenders = sourceFiles(join(ROOT, 'src'))
      .map((file) => ({ file: relative(join(ROOT, 'src'), file).replaceAll('\\', '/'), source: readFileSync(file, 'utf8') }))
      .filter(({ file, source }) => !NODE_ALLOWED.has(file) && runtimeNodeImports(source))
      .map(({ file }) => file)
    expect(offenders).toEqual([])
  })

  it('does not use process, Buffer or require in the library source', () => {
    const offenders = sourceFiles(join(ROOT, 'src'))
      .map((file) => ({ file: relative(join(ROOT, 'src'), file).replaceAll('\\', '/'), source: readFileSync(file, 'utf8') }))
      .filter(({ file, source }) => !NODE_ALLOWED.has(file) && /\b(?:process\.|Buffer\.|require\()/.test(source))
      .map(({ file }) => file)
    expect(offenders).toEqual([])
  })
})
