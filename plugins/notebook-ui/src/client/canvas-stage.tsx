/**
 * The Konva stage element: the one canvas the notebook's card atlas is painted
 * into. This file owns only the element — its lifetime, gestures, transform and
 * scene live in `use-canvas-stage` — so React's render surface stays one div
 * while Konva owns every pixel inside it.
 *
 * Konva 舞台元素：记事本卡片图集所画进的那一块画布。本文件只拥有元素——它的生命
 * 周期、手势、变换与场景住在 `use-canvas-stage`——于是 React 的渲染面只剩一个 div，
 * 里面每个像素归 Konva 所有。
 *
 * @module @veren/notebook-ui/client/canvas-stage
 */

import { useCanvasStage } from './use-canvas-stage.ts'
import type { CanvasStageProps } from './use-canvas-stage.ts'

export type { CanvasStageProps } from './use-canvas-stage.ts'

/**
 * Render the canvas stage.
 * @param props - the viewport controller plus everything the scene is assembled from.
 * @returns the stage element React owns.
 *
 * 渲染画布舞台。返回 React 拥有的舞台元素。
 */
export function CanvasStage(props: CanvasStageProps): React.ReactElement {
  const { ref, dragging } = useCanvasStage(props)
  return (
    <div
      ref={ref}
      className={`notebook-canvas-stage${dragging ? ' is-dragging' : ''}`}
      data-canvas-stage
      aria-hidden="true"
    />
  )
}
