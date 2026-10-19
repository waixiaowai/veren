// 临时分析脚本：列出每个包 src 里对 @deepseek-ai/* 的取值导入与仅类型导入。
// Temporary analysis: value vs type-only @deepseek-ai imports per package.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const groups = ['packages/commander', 'packages/compiler', 'packages/graph', 'packages/yaml-parser', 'packages/core']

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      walk(path, out)
    } else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(path)
  }
  return out
}

for (const group of groups) {
  const base = join(root, group)
  let dirs
  try { dirs = readdirSync(base, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => join(base, e.name)) }
  catch { dirs = [base] }
  for (const dir of dirs) {
    let pkg
    try { pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) } catch { continue }
    const src = join(dir, 'src')
    let files = []
    try { if (statSync(src).isDirectory()) files = walk(src) } catch { continue }
    const value = new Set(), typeOnly = new Set()
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      for (const m of text.matchAll(/import\s+(type\s+)?[^;]*?from\s+'(@deepseek-ai\/[^']+)'/gs)) {
        const spec = m[2].split('/').slice(0, 2).join('/')
        ;(m[1] ? typeOnly : value).add(spec)
      }
      for (const m of text.matchAll(/import\s*\(\s*'(@deepseek-ai\/[^']+)'\s*\)/g)) value.add(m[1].split('/').slice(0, 2).join('/'))
    }
    console.log(`\n${pkg.name}`)
    console.log(`  deps: ${Object.keys(pkg.dependencies ?? {}).filter(n => n.startsWith('@deepseek-ai/')).map(n => `${n}@${pkg.dependencies[n]}`).join(', ') || '-'}`)
    console.log(`  peer: ${Object.keys(pkg.peerDependencies ?? {}).join(', ') || '-'}`)
    console.log(`  value: ${[...value].join(', ') || '-'}`)
    console.log(`  type:  ${[...typeOnly].sort().join(', ') || '-'}`)
  }
}
