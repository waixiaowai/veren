/**
 * Dialect audits for the IM panel's stylesheet — the machine-checkable half of
 * the state × layout matrix contract (2026-10-28).
 *
 * The sheet may only space on the 4px grid (pills get a 1-2px optical nudge)
 * and may only color through the shared --dsw/--im tokens: a raw color breaks
 * every theme at once, and an off-grid sheet drifts one nudge at a time. The
 * full contract lives in the panel.css header.
 *
 * IM 面板样式表的方言审计——状态×布局矩阵契约中可机器校验的那一半（2026-10-28）。
 *
 * 样式表只许按 4px 网格取间距（药丸元素允许 1-2px 光学微调），颜色只许走共享
 * --dsw/--im token：裸色值会一次性破坏所有主题，离格间距会一次一点地漂移。
 * 完整契约见 panel.css 文件头。
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The shared sheet, comments stripped so the contract text can't trip the audits. */
const sheet = readFileSync(join(root, 'src/client/panel.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')

/** Optical nudges only pills may take; everything else sits on the 4px grid. */
const NUDGES = new Set(['1px', '2px'])

describe('panel dialect: spacing grid', () => {
  it('keeps every margin/gap/padding on the 4px grid (pills may nudge 1-2px)', () => {
    const offenders: string[] = []
    const declaration = /\b(?:margin|gap|padding)(?:-(?:top|right|bottom|left))?\s*:\s*([^;{}]+)[;}]/g
    for (const match of sheet.matchAll(declaration)) {
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
  it('introduces no raw colors — everything rides the shared tokens', () => {
    const raw = [...sheet.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(match => match[0])
    // The one allowed value: the on-accent label's own fallback on .im-button-primary.
    // 唯一放行值：.im-button-primary 上 on-accent 文字色自带的兜底。
    expect(raw).toEqual(['#fff'])
  })
})
