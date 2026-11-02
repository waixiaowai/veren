/**
 * The list page's first-screen rendering: the waiting-list section (M2 of
 * docs/notebook-roadmap.cn.md) surfaces lost cards honestly, including the
 * empty state. Pure render assertions over a fake snapshot — no storage, no
 * agent.
 *
 * 列表页首屏渲染：待加工区（docs/notebook-roadmap.cn.md 的 M2）如实浮出迷失
 * 卡片，包括空态。对假快照做纯渲染断言——无存储、无 agent。
 */

import { describe, expect, it } from 'vitest'
import { renderListFirstScreen } from '../src/first-screen.ts'

describe('list first screen waiting-list section / 列表首屏待加工区', () => {
  it('renders stale orphan cards with the processing call-to-action', () => {
    const text = renderListFirstScreen({
      available: true,
      owner: 'standard',
      notes: [{ id: 'n1', title: '某卡', excerpt: '摘要', updatedAt: '2026-11-01T00:00:00.000Z', kind: 'permanent' }],
      hubs: [],
      stale: [
        { id: 'old-1', title: 'Sub2API 运营playbook', updatedAt: '2026-10-21T06:48:09.327Z' },
        { id: 'old-2', title: '2.0.4 回归', updatedAt: '2026-10-24T14:34:00.760Z' },
      ],
      riddles: [{ aTitle: '甲卡', bTitle: '乙卡', shared: 2 }],
      intake: { fleet: [], overdue: [] },
    })
    expect(text).toContain('待加工区')
    expect(text).toContain('Sub2API 运营playbook（old-1')
    expect(text).toContain('2.0.4 回归（old-2')
    // 新分类下待加工区是永久/项目卡的迷失信号：教学是链上归宿，不是炼成（它们已是永久卡）。
    // / Under the new taxonomy the waiting list signals lost permanent/project cards: the
    // teaching is anchoring, not promotion (they are already permanent).
    expect(text).toContain('链上归宿')
    expect(text).toContain('进料口：空')
    expect(text).toContain('盒的谜面')
    expect(text).toContain('「甲卡」与「乙卡」共享 2 个邻居，却从未互链')
  })

  it('states the empty waiting list honestly', () => {
    const text = renderListFirstScreen({
      available: true,
      owner: 'standard',
      notes: [{ id: 'n1', title: '某卡', excerpt: '摘要', updatedAt: '2026-11-01T00:00:00.000Z', kind: 'permanent' }],
      hubs: [],
      stale: [],
      riddles: [],
      intake: { fleet: [], overdue: [] },
    })
    expect(text).toContain('待加工区：空')
    expect(text).toContain('每张永久/项目卡都至少有一条入链指向它')
    expect(text).toContain('盒的谜面：暂无')
  })
})
