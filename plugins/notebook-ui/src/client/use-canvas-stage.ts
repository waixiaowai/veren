/**
 * The Konva stage's lifecycle, split out of the component so the component is
 * only a div and every hook stays a single responsibility. One stage owns the
 * canvas for the element's lifetime; the scene inside it is rebuilt whenever
 * its inputs change (never mid-drag — a poll must not destroy the card under
 * the pointer), and the viewport transform is written straight onto the stage.
 *
 * React owns the verdicts (layout, palette, scene rebuilds); Konva owns the
 * pixels, hit testing, card dragging and stage panning. The transform is the
 * same (x, y) translation plus `zoom` scale the DOM world used, so fit, zoom
 * buttons and the cursor-anchored wheel keep their arithmetic unchanged.
 *
 * Konva 舞台的生命周期，自组件拆出，让组件只剩一个 div、每个钩子只剩单一职责。
 * 元素一生只有一个舞台；里面的场景在输入变化时重建（绝不在拖拽中重建——轮询不得
 * 毁掉指针下的卡片），视口变换直接写进舞台。
 *
 * React 拥有判断（布局、调色板、场景重建）；Konva 拥有像素、命中测试、卡片拖拽与
 * 舞台平移。变换与旧 DOM 世界相同（(x, y) 平移加 `zoom` 缩放），因此适配、缩放
 * 按钮与光标锚定滚轮保持原有算术。
 *
 * @module @veren/notebook-ui/client/use-canvas-stage
 */

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import { Layer } from 'konva/lib/Layer'
import { Stage } from 'konva/lib/Stage'
import type { CardDragHandlers, Translate } from './canvas-card.ts'
import { bindCanvasGesture } from './canvas-gesture.ts'
import type { CanvasLayout } from './canvas-layout.ts'
import { createScene } from './canvas-scene.ts'
import type { CanvasScene } from './canvas-scene.ts'
import type { CanvasPalette } from './canvas-theme.ts'
import { PAN_THRESHOLD } from './canvas-viewport-math.ts'
import type { CanvasViewportController } from './canvas-viewport.ts'
import type { CanvasEdgeView, CanvasNodeView } from './remote.ts'

/** Everything the stage paints and every gesture it reports. 舞台所画的一切与所报的每个手势。 */
export interface CanvasStageProps {
  readonly viewport: CanvasViewportController
  readonly layout: CanvasLayout
  readonly nodesById: ReadonlyMap<string, CanvasNodeView>
  readonly edges: readonly CanvasEdgeView[]
  /** `undefined` until the theme is read; the canvas stays blank for that frame. 主题读取完成前为 `undefined`；那一帧画布保持空白。 */
  readonly palette: CanvasPalette | undefined
  readonly t: Translate
  /** Called once per dropped card, in layout coordinates. 每张卡落下时调用一次，坐标为布局坐标。 */
  readonly onNodeDragEnd: (id: string, x: number, y: number) => void
}

/** The imperative handles the scene and the stage share. 场景与舞台共享的命令式句柄。 */
interface StageHandles {
  readonly stage: { current: Stage | null }
  readonly layer: { current: Layer | null }
  readonly scene: { current: CanvasScene | null }
  readonly hovered: { current: number }
  readonly nodeDragging: { current: boolean }
  readonly renew: { current: boolean }
}

/** Mint the handles once: their identity is what keeps the effects from re-running. 一次铸出句柄：它们的身份正是效果不重跑的原因。 */
function useStageHandles(): StageHandles {
  return useMemo<StageHandles>(() => ({
    stage: { current: null }, layer: { current: null }, scene: { current: null },
    hovered: { current: -1 }, nodeDragging: { current: false }, renew: { current: false },
  }), [])
}

/** Keep the latest props for imperative listeners that outlive a render. 为跨渲染存活的命令式监听器保留最新 props。 */
function useLiveProps(props: CanvasStageProps): { readonly current: Pick<CanvasStageProps, 'viewport' | 'onNodeDragEnd'> } {
  const live = useRef({ viewport: props.viewport, onNodeDragEnd: props.onNodeDragEnd })
  live.current = { viewport: props.viewport, onNodeDragEnd: props.onNodeDragEnd }
  return live
}

/** Kill the browser's own gesture at the press: a pan must never paint a text selection. 在按下处终止浏览器自己的手势：平移绝不刷出文字选中。 */
function useCanvasGesture(ref: { current: HTMLDivElement | null }): void {
  useEffect(() => {
    const container = ref.current
    if (container === null) return
    return bindCanvasGesture({
      surface: container,
      root: window,
      clearSelection: () => { window.getSelection()?.removeAllRanges() },
    })
  }, [ref])
}

/** Build the stage and its one layer; the disposer drops both and the scene. 建舞台与它唯一的图层；disposer 连场景一起丢掉。 */
function createStage(container: HTMLDivElement, handles: StageHandles, callbacks: {
  readonly onPanState: (dragging: boolean) => void
  readonly onHover: (index: number) => void
  readonly syncView: (x: number, y: number) => void
}): () => void {
  const stage = new Stage({
    container,
    width: Math.max(1, container.clientWidth),
    height: Math.max(1, container.clientHeight),
  })
  const layer = new Layer()
  stage.add(layer)
  stage.draggable(true)
  stage.dragDistance(PAN_THRESHOLD)
  const sync = (): void => {
    const point = stage.position()
    callbacks.syncView(point.x, point.y)
  }
  stage.on('dragstart', event => { if (event.target === stage) callbacks.onPanState(true) })
  stage.on('dragmove', event => { if (event.target === stage) sync() })
  stage.on('dragend', event => {
    if (event.target !== stage) return
    callbacks.onPanState(false)
    sync()
  })
  stage.on('mouseleave', () => { callbacks.onHover(-1) })
  handles.stage.current = stage
  handles.layer.current = layer
  return () => {
    stage.destroy()
    handles.stage.current = null
    handles.layer.current = null
    handles.scene.current = null
  }
}

/** Own the stage for the element's lifetime. 为元素一生持有舞台。 */
function useStageLifecycle(ref: { current: HTMLDivElement | null }, handles: StageHandles, live: { current: Pick<CanvasStageProps, 'viewport' | 'onNodeDragEnd'> }, onHover: (index: number) => void, setPanning: (dragging: boolean) => void): void {
  useEffect(() => {
    const container = ref.current
    if (container === null) return
    return createStage(container, handles, {
      onPanState: setPanning,
      onHover,
      syncView: (x, y) => {
        live.current.viewport.setView(current => (
          current.x === x && current.y === y ? current : { ...current, x, y }
        ))
      },
    })
  }, [ref, handles, live, onHover, setPanning])
}

/** The stage fills the measured viewport. 舞台铺满量得的视口。 */
function useStageSize(stage: RefObject<Stage | null>, size: { readonly width: number; readonly height: number }): void {
  useEffect(() => {
    const current = stage.current
    if (current === null) return
    current.size({ width: Math.max(1, size.width), height: Math.max(1, size.height) })
    current.batchDraw()
  }, [stage, size.width, size.height])
}

/** The viewport transform, unless the user is panning right now. 视口变换；正在平移时跳过。 */
function useStageTransform(stage: RefObject<Stage | null>, view: { readonly x: number; readonly y: number; readonly zoom: number }): void {
  useEffect(() => {
    const current = stage.current
    if (current === null || current.isDragging()) return
    current.position({ x: view.x, y: view.y })
    current.scale({ x: view.zoom, y: view.zoom })
    current.batchDraw()
  }, [stage, view.x, view.y, view.zoom])
}

/** The card drag face: start lifts the card, move re-routes its edges, drop persists and renews a deferred scene. 卡片的拖拽面：起手抬起，移动重接边，落下持久化并续上被推迟的场景。 */
function useCardHandlers(handles: StageHandles, live: { current: Pick<CanvasStageProps, 'viewport' | 'onNodeDragEnd'> }, setDragging: (dragging: boolean) => void, renewScene: () => void): CardDragHandlers {
  return useMemo<CardDragHandlers>(() => ({
    onDragStart: (): void => {
      handles.nodeDragging.current = true
      setDragging(true)
    },
    onDragMove: (): void => {
      handles.scene.current?.syncEdges()
    },
    onDragEnd: (id: string, x: number, y: number): void => {
      handles.nodeDragging.current = false
      setDragging(false)
      live.current.onNodeDragEnd(id, x, y)
      if (handles.renew.current) {
        handles.renew.current = false
        renewScene()
      }
    },
  }), [handles, live, setDragging, renewScene])
}

/** Rebuild the scene when its inputs change; never mid-drag — the drop re-runs this. 输入变化即重建场景；绝不在拖拽中重建——落下时再跑一次。 */
function useStageScene(props: CanvasStageProps, handles: StageHandles, nonce: number, onHover: (index: number) => void, handlers: CardDragHandlers): void {
  const { layout, nodesById, edges, palette, t } = props
  useEffect(() => {
    const layer = handles.layer.current
    if (layer === null || palette === undefined) return
    if (handles.nodeDragging.current) {
      handles.renew.current = true
      return
    }
    const scene = createScene({
      layer, layout, nodesById, edges, palette, t,
      hovered: handles.hovered.current, onHover, handlers,
    })
    handles.scene.current = scene
    layer.batchDraw()
    return () => {
      scene.destroy()
      if (handles.scene.current === scene) handles.scene.current = null
    }
  }, [handles, layout, nodesById, edges, palette, t, nonce, onHover, handlers])
}

/**
 * Bind the whole stage: lifecycle, gesture, size, transform, and the scene.
 * @param props - the viewport controller plus everything the scene is assembled from.
 * @returns the element ref React must own and whether a pan is in flight.
 *
 * 绑定整个舞台：生命周期、手势、尺寸、变换与场景。返回 React 必须拥有的元素 ref
 * 以及是否正在平移。
 */
export function useCanvasStage(props: CanvasStageProps): { readonly ref: { current: HTMLDivElement | null }; readonly dragging: boolean } {
  const ref = props.viewport.ref
  const handles = useStageHandles()
  const live = useLiveProps(props)
  const [dragging, setDragging] = useState(false)
  const [nonce, setNonce] = useState(0)
  const onHover = useCallback((index: number): void => {
    handles.hovered.current = index
    handles.scene.current?.setHover(index)
  }, [handles])
  const renewScene = useCallback((): void => { setNonce(current => current + 1) }, [])
  const handlers = useCardHandlers(handles, live, setDragging, renewScene)
  useCanvasGesture(ref)
  useStageLifecycle(ref, handles, live, onHover, setDragging)
  useStageSize(handles.stage, props.viewport.size)
  useStageTransform(handles.stage, props.viewport.view)
  useStageScene(props, handles, nonce, onHover, handlers)
  return { ref, dragging }
}
