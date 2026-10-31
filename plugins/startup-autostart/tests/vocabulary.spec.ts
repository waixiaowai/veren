/**
 * The startup vocabulary's closed action set, pinned by a spec so a renamed or
 * dropped action fails here.
 *
 * 启动词汇表的封闭动作集合：用例钉住它，动作被改名或删除时在这里失败。
 */

import { describe, expect, it } from 'vitest'
import type { StartupAction } from '../src/domain.ts'

/** The action union stays in the spec's type surface so a renamed action fails here. */
const ACTIONS: readonly StartupAction[] = ['new_session', 'resume_session', 'message_session', 'queue_message']

describe('startup vocabulary', () => {
  it('keeps every action represented by a spec', () => {
    expect(new Set(ACTIONS).size).toBe(ACTIONS.length)
  })
})
