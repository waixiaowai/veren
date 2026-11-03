/**
 * The intake dock's fold rule — the executable half of O7 in
 * docs/notebook-canvas-optimization-task.cn.md.
 *
 * The dock used to hold the canvas height even with one overdue card. O7 keeps
 * its current form up to three cards and turns four or more into a one-line
 * count with an expand switch, so the canvas keeps its height until the reader
 * asks for the queue.
 *
 * 进料口折叠规则——docs/notebook-canvas-optimization-task.cn.md O7 的可执行
 * 一半。
 *
 * 进料口过去即使只有一张过期卡也常驻占底。O7 让三张以内保持现形态，四张起收成
 * 一行计数加展开钮，读者要看时画布才让出高度。
 */

import { describe, expect, it } from 'vitest'
import { dockView } from '../src/client/canvas-dock-fold.ts'

describe('intake dock — fold rule / 折叠规则', () => {
  it('keeps the full list at three overdue cards or fewer', () => {
    expect(dockView(1, false)).toEqual({ folded: false, showRows: true })
    expect(dockView(3, false)).toEqual({ folded: false, showRows: true })
  })

  it('folds to one count line from four cards', () => {
    expect(dockView(4, false)).toEqual({ folded: true, showRows: false })
    expect(dockView(9, false)).toEqual({ folded: true, showRows: false })
  })

  it('shows the rows again once the reader expands', () => {
    expect(dockView(4, true)).toEqual({ folded: true, showRows: true })
  })

  it('never folds an empty queue (the dock itself renders nothing)', () => {
    expect(dockView(0, false)).toEqual({ folded: false, showRows: true })
  })
})
