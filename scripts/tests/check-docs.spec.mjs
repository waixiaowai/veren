import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { auditDocs, declarationsOf } from '../check-docs.mjs'

/**
 * check-docs 自测：声明抽取的保守性（只有标记行才算）+ 临时夹具仓验证
 * "声明在源码里存在 → 放行、不存在 → 漂移、无声明 → 跳过"。
 * Self-test for check-docs: conservative declaration extraction (marker lines
 * only) plus a temp fixture workspace proving "declared and present passes,
 * declared but absent drifts, undeclared skips".
 */
describe('check-docs', () => {
  it('只认标记行：正文里的反引号名字、代码块与缩进行不产生声明', () => {
    const text = [
      '# 标题',
      '',
      '正文提到 `list_tasks` 不算声明；',
      '',
      '```ts',
      '// tool: fake_in_code_block 也不算',
      '```',
      '',
      '```yaml',
      'config:',
      '  tool: bash',
      '```',
      '',
      '- tool: `complete_task`（带括注也算）',
      'event: task-center/completed',
      '* service: `taskCenter`',
      '  - skill: renhua',
    ].join('\n')
    expect(declarationsOf(text)).toEqual([
      { marker: 'tool', name: 'complete_task', line: 14 },
      { marker: 'event', name: 'task-center/completed', line: 15 },
      { marker: 'service', name: 'taskCenter', line: 16 },
    ])
  })

  const dir = mkdtempSync(join(tmpdir(), 'check-docs-fixture-'))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  it('夹具仓：在源码的声明放行、不在的漂移、无声明跳过', async () => {
    mkdirSync(join(dir, 'plugins', 'good', 'src'), { recursive: true })
    writeFileSync(join(dir, 'plugins', 'good', 'src', 'index.ts'),
      "export const name = 'good'\nctx.tools.register({ name: 'good_tool' })\nctx.on('good/event', () => undefined)\n")
    writeFileSync(join(dir, 'plugins', 'good', 'README.md'), [
      '# good',
      '- tool: `good_tool`',
      '- event: `good/event`',
      '- tool: `ghost_tool`',
      '- event: `ghost/event`',
    ].join('\n'))
    mkdirSync(join(dir, 'plugins', 'silent', 'src'), { recursive: true })
    writeFileSync(join(dir, 'plugins', 'silent', 'src', 'index.ts'), 'export const name = "silent"\n')
    writeFileSync(join(dir, 'plugins', 'silent', 'README.md'), '# silent\n\nNo explicit declarations here.\n')

    const results = await auditDocs(dir)
    const good = results.find((result) => result.doc.includes('good') && result.doc.endsWith('README.md'))
    const silent = results.find((result) => result.doc.includes('silent'))
    expect(good.declarations.length).toBe(4)
    expect(good.missing.map((item) => item.name).sort()).toEqual(['ghost/event', 'ghost_tool'])
    expect(silent.declarations.length).toBe(0)
    expect(silent.missing.length).toBe(0)
  })
})
