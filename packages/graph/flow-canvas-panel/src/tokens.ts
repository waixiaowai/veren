/**
 * Cordis service names this plugin addresses.
 *
 * Kept in a decorator-free module so unit tests can compare them with the
 * authoritative tokens without importing the decorated Host entry (whose
 * standard decorators require the build pipeline, not the test transform).
 *
 * 本插件寻址的 Cordis 服务名。放在无装饰器的模块里，单元测试可以与权威令牌对比，
 * 而不必导入带标准装饰器的宿主入口（它需要构建管线，测试转换不处理）。
 *
 * @module @deepseek-ai/dsh-graph-flow-canvas-panel/tokens
 */

/** Cordis service name of the canvas data source (`FlowCanvasToken`). */
export const FLOW_CANVAS_SERVICE = 'graphFlowCanvas'

/** Cordis service name of the flow engine (`FlowEngineToken`). */
export const FLOW_ENGINE_SERVICE = 'graphFlowEngine'

/** Cordis service name of the flow approval broker (`FlowApprovalToken`). */
export const FLOW_APPROVAL_SERVICE = 'graphFlowApproval'
