import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { expect, it } from 'vitest'

const dir = join(process.cwd(), 'src/client/styles')
/** The stylesheet is split by vocabulary domain; the gates run over each file and their union. */
/* 样式表按词汇域拆分；各门禁逐文件与并集运行。 */
const sheets = readdirSync(dir).filter(name => name.endsWith('.css')).sort()
const css = sheets.map(name => readFileSync(join(dir, name), 'utf8')).join('\n')
const client = join(process.cwd(), 'src/client')
const code = readdirSync(client).filter(name => /\.tsx?$/.test(name)).map(name => readFileSync(join(client, name), 'utf8')).join('\n')

it('styles only classes a component uses', () => {
  // Template literals like `dt-btn-${variant}` match any class with that prefix.
  const prefixes = [...code.matchAll(/(dt-[\w-]*-)\$\{/g)].map(match => match[1]!)
  const used = (name: string) => new RegExp(`(?<![\\w-])${name}(?![\\w-])`).test(code) || prefixes.some(prefix => name.startsWith(prefix))
  const classes = new Set([...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.(dt-[\w-]+)/g)].map(match => match[1]!))
  expect([...classes].filter(name => !used(name))).toEqual([])
})

it('writes one rule per line, each selector once within its block', () => {
  for (const sheet of sheets) {
    const blocks: string[][] = [[]]
    for (const line of readFileSync(join(dir, sheet), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map(text => text.trim())
      .filter(Boolean)) {
      if (line === '}') { blocks.pop(); continue }
      if (/^@(media|container|supports)\b.*\{$/.test(line)) { blocks.push([]); continue }
      // A rule, or a keyframes rule with its steps, opens and closes on its line.
      expect(line).toMatch(/^[^{}]+\{[^{}]*\}$|^@keyframes [\w-]+ \{( [^{}]+ \{[^{}]*\})+ \}$/)
      if (line.startsWith('@')) continue
      const selector = line.slice(0, line.indexOf('{')).trim()
      expect(blocks.at(-1)).not.toContain(selector)
      blocks.at(-1)!.push(selector)
    }
  }
})
