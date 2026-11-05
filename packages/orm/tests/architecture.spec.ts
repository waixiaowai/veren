import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SOURCE_ROOT = fileURLToPath(new URL('../src/', import.meta.url))

/** 递归收集源文件。 / Collect source files recursively. */
function sourceFiles(directory: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...sourceFiles(full))
    else if (entry.name.endsWith('.ts')) files.push(full)
  }
  return files
}

/** 去掉注释，避免把说明文字误判成分支。 / Strip comments so documentation is not mistaken for branches. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

describe('architecture guard', () => {
  it('keeps database names out of core control flow', () => {
    const pattern = /\bdialect\.name\s*===|===\s*['"](?:postgres|mysql|sqlite)['"]/
    const offenders = sourceFiles(SOURCE_ROOT)
      .filter((file) => pattern.test(stripComments(readFileSync(file, 'utf8'))))
      .map((file) => file.slice(SOURCE_ROOT.length))

    expect(offenders).toEqual([])
  })
})
