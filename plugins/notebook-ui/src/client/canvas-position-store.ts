/**
 * The dragged-position store: view state, nothing else. A drag rearranges the
 * canvas and the result rides localStorage per box — the box's data is never
 * touched. Positions are keyed by owner id, because each box owns its own
 * arrangement; a card that disappears simply loses its stored spot, and a card
 * that reappears lands on the deterministic layout until dragged again.
 *
 * Functions take the storage explicitly so the store is testable without a
 * browser and so the one guarded read lives here. Every failure is silent by
 * design: a refusing storage must never break the canvas.
 *
 * 拖拽位置仓：纯视图态。拖拽重排画布，结果按盒存进 localStorage——盒的数据分文
 * 不动。位置按归属 id 归档，因为每盒有自己的摆法；消失的卡自然丢掉它的位置，再出现
 * 时先落在确定性布局上，直到再次被拖。
 *
 * 函数显式接收 storage，因此无需浏览器即可测试，唯一带守卫的读取也在这里。所有失败
 * 按设计静默：拒绝的存储绝不能弄坏画布。
 *
 * @module @veren/notebook-ui/client/canvas-position-store
 */

import type { PlacedNode } from './canvas-layout.ts'

/** localStorage key prefix: one arrangement per owner. 键前缀：每个归属一套摆法。 */
const KEY_PREFIX = 'notebook-canvas-positions:'

/** The storage a browser exposes, or `undefined` when privacy mode refuses it. 浏览器暴露的存储；隐私模式拒绝时为 `undefined`。 */
function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage ?? undefined
  } catch {
    return undefined
  }
}

/** One stored entry must be a finite pair; anything else is dropped silently. 一条存储项必须是有限数对，其余静默丢弃。 */
function readEntry(value: unknown): PlacedNode | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const candidate = value as { id?: unknown; x?: unknown; y?: unknown }
  if (typeof candidate.id !== 'string') return undefined
  if (typeof candidate.x !== 'number' || typeof candidate.y !== 'number') return undefined
  if (!Number.isFinite(candidate.x) || !Number.isFinite(candidate.y)) return undefined
  return { id: candidate.id, x: candidate.x, y: candidate.y }
}

/**
 * Load one box's dragged positions.
 * @param owner - the notebook owner id (the storage key's suffix).
 * @param store - where to read from; defaults to the browser's localStorage.
 * @returns the stored positions; a missing or malformed entry yields empty.
 *
 * 载入某盒拖拽过的位置。缺失或损坏的条目返回空表。
 */
export function loadPositions(owner: string, store: Storage | undefined = safeStorage()): Map<string, PlacedNode> {
  if (store === undefined) return new Map()
  try {
    const raw = store.getItem(KEY_PREFIX + owner)
    if (raw === null) return new Map()
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) return new Map()
    const positions = new Map<string, PlacedNode>()
    for (const value of Object.values(parsed)) {
      const entry = readEntry(value)
      if (entry !== undefined) positions.set(entry.id, entry)
    }
    return positions
  } catch {
    return new Map()
  }
}

/**
 * Persist one box's dragged positions.
 * @param owner - the notebook owner id.
 * @param positions - the arrangement to keep.
 * @param store - where to write; defaults to the browser's localStorage.
 *
 * 持久化某盒拖拽过的位置。配额或隐私模式拒绝写入时静默——本会话的拖拽仍然可用。
 */
export function savePositions(owner: string, positions: ReadonlyMap<string, PlacedNode>, store: Storage | undefined = safeStorage()): void {
  if (store === undefined) return
  try {
    store.setItem(KEY_PREFIX + owner, JSON.stringify(Object.fromEntries(positions)))
  } catch {
    // Quota or privacy modes refuse storage; dragging still works this session.
    // 配额或隐私模式会拒绝存储；拖拽在本会话仍然可用。
  }
}
