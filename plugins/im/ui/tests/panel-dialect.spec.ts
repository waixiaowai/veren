/**
 * Dialect audits for the IM panel's stylesheet — the machine-checkable half of
 * the state × layout matrix contract (2026-10-28).
 *
 * The sheet may only space on the 4px grid (pills get a 1-2px optical nudge), and
 * raw colour literals are confined to the token block that opens the sheet: the
 * Cumora palette is defined once there, every rule below reads a `--im-*` alias.
 * A colour literal in a rule breaks every theme at once, and an off-grid sheet
 * drifts one nudge at a time. The full contract lives in the panel.css header.
 *
 * IM 面板样式表的方言审计——状态×布局矩阵契约中可机器校验的那一半（2026-10-28）。
 *
 * 样式表只许按 4px 网格取间距（药丸允许 1-2px 微调）；裸色值只许出现在文件开头的令牌块，
 * Cumora 调色板在那里定义一次，下面每条规则都读 `--im-*` 别名。规则里写裸色会一次性破坏
 * 所有主题，离格间距会一次一点地漂移。完整契约见 panel.css 文件头。
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The shared sheet, comments stripped so the contract text can't trip the audits. */
const raw = readFileSync(join(root, 'src/client/panel.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** Everything from the type scale onward: rules, where only tokens are allowed. */
const TOKEN_BLOCK_END = '.im-title {'
const sheet = raw.includes(TOKEN_BLOCK_END) ? raw.slice(raw.indexOf(TOKEN_BLOCK_END)) : raw

/** Optical nudges only pills may take; everything else sits on the 4px grid. */
const NUDGES = new Set(['1px', '2px'])

describe('panel dialect: spacing grid', () => {
  it('keeps every margin/gap/padding on the 4px grid (pills may nudge 1-2px)', () => {
    const offenders: string[] = []
    const declaration = /\b(?:margin|gap|padding)(?:-(?:top|right|bottom|left))?\s*:\s*([^;{}]+)[;}]/g
    for (const match of raw.matchAll(declaration)) {
      for (const token of match[1]!.trim().split(/\s+/)) {
        const parsed = /^(-?\d+(?:\.\d+)?)(px)?$/.exec(token)
        if (parsed === null) continue
        const pixels = Number(parsed[1])
        if (parsed[2] !== 'px' || pixels % 4 === 0 || NUDGES.has(token)) continue
        offenders.push(`${match[0].slice(0, 40)}…`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('panel dialect: colors', () => {
  it('defines the palette once and keeps every rule on tokens', () => {
    expect(raw).toContain(TOKEN_BLOCK_END)
    const literals = [...sheet.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(match => match[0])
    expect(literals).toEqual([])
  })

  it('keeps the palette in both schemes (light block plus the dark override)', () => {
    expect(raw).toContain('@media (prefers-color-scheme: dark)')
    expect(raw.match(/--im-paper:/g)?.length).toBe(2)
  })
})
