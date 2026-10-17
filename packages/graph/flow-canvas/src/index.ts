/**
 * @deepseek-ai/dsh-graph-flow-canvas —— flow 的画布数据源（静态投影 + 运行投影）。
 *
 * @deepseek-ai/dsh-graph-flow-canvas — the canvas data source for flows
 * (static projection + run projection).
 *
 * 上层（画布、CLI 画图、编辑器插件）只依赖本包导出的 JSON 形状，不需要
 * 了解内核调度、黑板或事件细节。布局数据由调用方填充，内核与本包都不存。
 * Upper layers (canvas, CLI renderer, editor plugin) depend only on the JSON
 * shapes exported here and never need kernel scheduling/blackboard/event
 * internals. Layout data is filled by the caller; neither the kernel nor this
 * package stores it.
 */

export { CanvasError, projectFlow } from './project.js';
export type { CanvasErrorCode } from './project.js';
export { apply, Config, FlowCanvasService, FlowCanvasToken, inject, name, provide } from './service.js';
export type { FlowCanvasConfig } from './service.js';
export { watchRun } from './watch.js';
export type {
    CanvasEdge,
    CanvasEdgeCondition,
    CanvasEdgeKind,
    CanvasEdgeLayout,
    CanvasFlow,
    CanvasLayout,
    CanvasNode,
    CanvasNodeLayout,
    CanvasNodeRuntime,
    CanvasNodeStatusChange,
    CanvasPoint,
    CanvasRunProjection,
    CanvasRunSnapshot,
    CanvasStatusListener,
    FlowCanvas,
    JsonPrimitive,
    JsonValue,
} from './types.js';
