/**
 * 面板样式方言审计：裸色值只许出现在文件开头的语义令牌块，下面每条规则都读
 * `--bdp-*` 别名；间距只许按 4px 网格（2px 以内的光学微调除外）——设计 §9
 * 令牌纪律的机器可校验面。
 * The panel stylesheet's dialect audit: raw color literals live only in the
 * semantic token block that opens the sheet, every rule below reads a `--bdp-*`
 * alias, and spacing sits on the 4px grid (2px optical nudges aside) — the
 * machine-checkable face of design §9's token discipline.
 *
 * @module tests/panel-dialect
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The shared sheet, comments stripped so the contract text can't trip the audits. */
const raw = readFileSync(join(root, 'src/client/panel.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** Everything from the tone rules onward: rules, where only tokens are allowed. */
const TOKEN_BLOCK_END = '.bdp-tone-success'
const sheet = raw.includes(TOKEN_BLOCK_END) ? raw.slice(raw.indexOf(TOKEN_BLOCK_END)) : raw

/** Optical nudges only tight rows may take; everything else sits on the 4px grid. */
const NUDGES = new Set(['1px', '2px'])

describe('panel dialect: spacing grid', () => {
  it('keeps every margin/gap/padding on the 4px grid (tight rows may nudge 1-2px)', () => {
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
    expect(raw.match(/--bdp-bg:/g)?.length).toBe(2)
  })
})
