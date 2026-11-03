/**
 * The canvas layout's properties: order-insensitive determinism, completeness,
 * the zoning invariants (fleeting strictly below the graph; hubs inner, islands
 * outer), the empty and single-node edges, and the loud failure on duplicate
 * ids. The executable half of docs/notebook-canvas-expiry-task.cn.md §3 D1/D6.
 *
 * 画布布局的性质：与顺序无关的确定性、完整性、分区不变式（闪念严格低于图区；
 * 枢纽在内、孤岛在外）、空输入与单节点边界，以及重复 id 的响亮失败。即
 * docs/notebook-canvas-expiry-task.cn.md §3 D1/D6 的可执行一半。
 */

import { describe, expect, it } from 'vitest'
import { applyOverrides, connectedComponent, edgePath, layoutCanvas } from '../src/client/canvas-layout.ts'
import { DEFAULT_ZOOM, initialView } from '../src/client/canvas-viewport-math.ts'
import type { CanvasNodeView } from '../src/client/remote.ts'

/** One node with only the fields the layout reads. 只带布局所读字段的节点。 */
function node(overrides: Partial<CanvasNodeView> & { id: string }): CanvasNodeView {
  return {
    title: overrides.id, excerpt: '', createdAt: '', updatedAt: '2026-11-01T00:00:00.000Z',
    kind: 'permanent', inbound: 0, outbound: 0, ...overrides,
  }
}

/** Radius of one placed node (the rings' tier test reads it). 某落位节点的半径（环层测试读它）。 */
const radiusOf = (layout: ReturnType<typeof layoutCanvas>, id: string): number => {
  const placed = layout.byId.get(id)!
  return Math.hypot(placed.x, placed.y)
}

describe('canvas layout — determinism / 确定性', () => {
  it('gives the same coordinates twice and ignores input order', () => {
    const nodes = [
      node({ id: 'hub1', inbound: 3 }),
      node({ id: 'hub2', inbound: 1 }),
      node({ id: 'out1', outbound: 2 }),
      node({ id: 'isle1' }),
      node({ id: 'f1', kind: 'fleeting', aging: 'overdue', updatedAt: '2026-11-01T00:00:00.000Z' }),
      node({ id: 'f2', kind: 'fleeting', aging: 'fresh', updatedAt: '2026-11-02T00:00:00.000Z' }),
    ]
    const first = layoutCanvas(nodes)
    const second = layoutCanvas(nodes)
    expect(first.placed).toEqual(second.placed)
    const shuffled = [...nodes].reverse()
    expect(layoutCanvas(shuffled).placed).toEqual(first.placed)
  })

  it('places every node exactly once and keeps every coordinate finite', () => {
    const nodes = Array.from({ length: 40 }, (_, index) => node({ id: `n${String(index)}`, inbound: index % 3 }))
    const layout = layoutCanvas(nodes)
    expect(layout.placed).toHaveLength(40)
    expect(new Set(layout.placed.map(row => row.id)).size).toBe(40)
    for (const row of layout.placed) {
      expect(Number.isFinite(row.x)).toBe(true)
      expect(Number.isFinite(row.y)).toBe(true)
    }
  })

  it('fails loud on duplicate ids', () => {
    expect(() => layoutCanvas([node({ id: 'x' }), node({ id: 'x' })])).toThrow(/duplicate/)
  })
})

describe('canvas layout — zoning / 分区', () => {
  const nodes = [
    node({ id: 'hub', inbound: 5 }),
    node({ id: 'linked', inbound: 1 }),
    node({ id: 'outflow', outbound: 3 }),
    node({ id: 'island' }),
    node({ id: 'fleet-old', kind: 'fleeting', aging: 'overdue', updatedAt: '2026-11-01T00:00:00.000Z' }),
    node({ id: 'fleet-new', kind: 'fleeting', aging: 'fresh', updatedAt: '2026-11-02T00:00:00.000Z' }),
  ]
  const layout = layoutCanvas(nodes)
  const yOf = (id: string): number => layout.byId.get(id)!.y
  const citizens = nodes.filter(row => row.kind !== 'fleeting').map(row => row.id)
  const fleet = nodes.filter(row => row.kind === 'fleeting').map(row => row.id)

  it('keeps every fleeting card strictly below the graph zone', () => {
    const graphMaxY = Math.max(...citizens.map(yOf))
    const fleetMinY = Math.min(...fleet.map(yOf))
    expect(fleetMinY).toBeGreaterThan(graphMaxY)
  })

  it('orders the intake strip overdue first, oldest first', () => {
    // Two cards share row 0; the strip's order runs left to right.
    // 两卡同行；进料带顺序自左向右。
    const xOf = (id: string): number => layout.byId.get(id)!.x
    expect(xOf('fleet-old')).toBeLessThan(xOf('fleet-new'))
  })

  it('rings the citizens hubs-inner and islands-outer', () => {
    expect(radiusOf(layout, 'hub')).toBeLessThanOrEqual(radiusOf(layout, 'linked'))
    expect(radiusOf(layout, 'outflow')).toBeLessThanOrEqual(radiusOf(layout, 'island'))
    expect(radiusOf(layout, 'island')).toBeGreaterThan(0)
  })

  it('separates same-ring neighbors by at least a card width', () => {
    const hubs = ['hub', 'linked']
    for (let i = 0; i < hubs.length; i++) {
      for (let j = i + 1; j < hubs.length; j++) {
        const a = layout.byId.get(hubs[i]!)!
        const b = layout.byId.get(hubs[j]!)!
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(150)
      }
    }
  })
})

describe('canvas layout — edges / 边界', () => {
  it('returns an empty layout for an empty box', () => {
    const layout = layoutCanvas([])
    expect(layout.placed).toEqual([])
    expect(layout.width).toBe(0)
    expect(layout.height).toBe(0)
  })

  it('lays a fleeting-only box as one intake strip with no rings', () => {
    const layout = layoutCanvas([
      node({ id: 'f1', kind: 'fleeting', aging: 'fresh' }),
      node({ id: 'f2', kind: 'fleeting', aging: 'fresh' }),
    ])
    expect(layout.placed).toHaveLength(2)
    expect(layout.byId.get('f1')?.y).toBe(layout.byId.get('f2')?.y)
  })

  it('lays a single hub on the top of its ring, not at the origin', () => {
    const layout = layoutCanvas([node({ id: 'only', inbound: 2 })])
    const placed = layout.byId.get('only')!
    expect(placed.y).toBeLessThan(0)
    expect(Math.hypot(placed.x, placed.y)).toBeGreaterThan(0)
  })

  it('completes a 200-card synthetic box (the density budget input)', () => {
    const nodes = [
      ...Array.from({ length: 140 }, (_, i) => node({ id: `p${String(i)}`, inbound: i < 30 ? 3 : 0, outbound: i % 3 })),
      ...Array.from({ length: 60 }, (_, i) => node({
        id: `f${String(i)}`, kind: 'fleeting', aging: i < 20 ? 'overdue' : 'fresh',
        updatedAt: '2026-11-01T00:00:00.000Z',
      })),
    ]
    const layout = layoutCanvas(nodes)
    expect(layout.placed).toHaveLength(200)
    expect(layout.width).toBeGreaterThan(0)
    expect(layout.height).toBeGreaterThan(0)
  })
})

describe('canvas layout — dragged-position overrides / 拖拽位置叠加', () => {
  it('moves only the dragged ids and keeps the rest deterministic', () => {
    const nodes = [node({ id: 'a', inbound: 1 }), node({ id: 'b' })]
    const base = layoutCanvas(nodes)
    const moved = applyOverrides(base, new Map([['b', { id: 'b', x: 500, y: -300 }]]))
    expect(moved.byId.get('a')).toEqual(base.byId.get('a'))
    expect(moved.byId.get('b')).toEqual({ id: 'b', x: 500, y: -300 })
    // The bounds grow to keep fit covering the dragged card — outward drags
    // expand them, they never clip the card.
    // 边界随之增长，适配始终盖住被拖的卡——向外拖必扩张，绝不裁掉卡片。
    expect(moved.width).toBeGreaterThan(base.width)
    const far = applyOverrides(base, new Map([['b', { id: 'b', x: 500, y: 900 }]]))
    expect(far.height).toBeGreaterThan(base.height)
  })

  it('is the identity for empty overrides and prunes unknown ids implicitly', () => {
    const nodes = [node({ id: 'a' })]
    const base = layoutCanvas(nodes)
    expect(applyOverrides(base, new Map())).toBe(base)
    // A stale override for a deleted card simply never lands (no id matches).
    // 已删卡的陈旧覆盖自然无处落（无 id 命中）。
    const stale = applyOverrides(base, new Map([['ghost', { id: 'ghost', x: 1, y: 1 }]]))
    expect(stale.byId.get('a')).toEqual(base.byId.get('a'))
    expect(stale.byId.has('ghost')).toBe(false)
    // Dragging changes card positions, not the box's opening focus.
    // 拖拽改变卡片位置，不改变盒的打开焦点。
    expect(stale.focus).toEqual(base.focus)
  })
})

describe('canvas layout — opening focus / 打开焦点', () => {
  it('focuses the hub ring centroid, not the drawing bounds', () => {
    const layout = layoutCanvas([node({ id: 'hub', inbound: 2 })])
    const hub = layout.byId.get('hub')!
    expect(layout.focus).toEqual({ x: hub.x, y: hub.y })
  })

  it('falls back to the intake strip for a fleeting-only box', () => {
    const layout = layoutCanvas([
      node({ id: 'f1', kind: 'fleeting', aging: 'fresh' }),
      node({ id: 'f2', kind: 'fleeting', aging: 'fresh' }),
    ])
    expect(layout.focus.y).toBeGreaterThan(0)
  })

  it('keeps the origin for an empty box', () => {
    expect(layoutCanvas([]).focus).toEqual({ x: 0, y: 0 })
  })
})

describe('canvas viewport — readable opening view / 可读打开视口', () => {
  const size = { width: 800, height: 600 }

  it('opens at the readable default zoom, never a fit squeeze', () => {
    expect(DEFAULT_ZOOM).toBe(0.85)
    expect(initialView(layoutCanvas([]), size).zoom).toBe(0.85)
  })

  it('centers the hub centroid in the viewport', () => {
    const layout = layoutCanvas([node({ id: 'hub', inbound: 2 })])
    const view = initialView(layout, size)
    const hub = layout.byId.get('hub')!
    // Screen point of the focus: focus * zoom + translate == viewport centre.
    // 焦点在屏上的位置：焦点×缩放+平移 == 视口中心。
    expect(hub.x * view.zoom + view.x).toBeCloseTo(size.width / 2)
    expect(hub.y * view.zoom + view.y).toBeCloseTo(size.height / 2)
  })
})

describe('canvas edges — curved paths / 曲线边', () => {
  it('bends one chord along its normal instead of drawing a straight line', () => {
    const path = edgePath({ x: 0, y: 0 }, { x: 100, y: 0 })
    expect(path).toBe('M 0 0 Q 50 18 100 0')
  })

  it('mirrors the bend when the edge direction reverses', () => {
    expect(edgePath({ x: 100, y: 0 }, { x: 0, y: 0 })).toBe('M 100 0 Q 50 -18 0 0')
  })

  it('keeps a minimum bend on short edges and a cap on long ones', () => {
    expect(edgePath({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe('M 0 0 Q 5 16 10 0')
    // A 2000px chord would bend 360px; the cap keeps it at 110.
    // 2000px 的弦本应弯 360px；封顶把它留在 110。
    expect(edgePath({ x: 0, y: 0 }, { x: 2000, y: 0 })).toBe('M 0 0 Q 1000 110 2000 0')
  })

  it('degenerates to a point for coincident nodes', () => {
    expect(edgePath({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe('M 5 5')
  })
})

describe('connectedComponent — the selection chain / 选中链', () => {
  const edge = (sourceId: string, targetId: string) => ({ sourceId, targetId })

  it('grows the whole chain from the selected card, both directions', () => {
    // a ←→ b ←→ c   d (isolated)
    const edges = [edge('a', 'b'), edge('b', 'c')]
    const chain = connectedComponent('b', edges)
    expect(chain.has('a')).toBe(true)
    expect(chain.has('b')).toBe(true)
    expect(chain.has('c')).toBe(true)
    expect(chain.has('d')).toBe(false)
  })

  it('keeps the isolated card alone and includes the selected card always', () => {
    expect(connectedComponent('d', [edge('a', 'b')])).toEqual(new Set(['d']))
    expect(connectedComponent('x', [])).toEqual(new Set(['x']))
  })
})
