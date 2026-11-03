/**
 * The dragged-position hook: load one box's arrangement on owner switch, record
 * one card's spot on drop. The storage itself lives in `canvas-position-store`
 * (pure, testable); this file only binds it to React state.
 *
 * 拖拽位置的钩子：换归属时载入该盒摆法，卡片落下时记录位置。存储本身住在
 * `canvas-position-store`（纯函数、可测）；本文件只把它绑到 React 状态。
 *
 * @module @veren/notebook-ui/client/canvas-positions
 */

import { useCallback, useEffect, useState } from 'react'
import type { PlacedNode } from './canvas-layout.ts'
import { loadPositions, savePositions } from './canvas-position-store.ts'

/** Round a drag's coordinate so the stored arrangement stays stable. 取整拖拽坐标，保证存下来的摆法稳定。 */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/** The dragged-position state one canvas binds to: the overrides and the one move action. 画布绑定的拖拽位置状态：覆盖表与唯一的移动动作。 */
export interface DragPositions {
  readonly overrides: ReadonlyMap<string, PlacedNode>
  readonly move: (id: string, x: number, y: number) => void
}

/**
 * Own one box's dragged positions: load on owner switch, record on drop.
 * @param viewKey - the owner id, which is also the opening-view key.
 * @returns the overrides to layer over the deterministic layout and the drop action.
 *
 * 持有某盒的拖拽位置：换归属即载入，落下即记录。
 */
export function useDragPositions(viewKey: string): DragPositions {
  const [overrides, setOverrides] = useState<ReadonlyMap<string, PlacedNode>>(new Map)
  useEffect(() => {
    setOverrides(loadPositions(viewKey))
  }, [viewKey])
  const move = useCallback((id: string, x: number, y: number): void => {
    setOverrides(current => {
      const next = new Map(current)
      next.set(id, { id, x: round2(x), y: round2(y) })
      savePositions(viewKey, next)
      return next
    })
  }, [viewKey])
  return { overrides, move }
}
