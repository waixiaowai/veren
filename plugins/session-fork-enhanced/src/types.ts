/**
 * 分叉请求与模型选择的共享类型。本文件只放类型。
 * Shared types for fork requests and model selections. Types only.
 *
 * @module types
 */

/**
 * 归一化后的分叉请求：模型参数经校验后的形状。
 * The normalized fork request: the shape of model arguments after validation.
 */
export interface ForkRequest {
  /** 源会话 id（非空字符串，尚未 brand 化）。
   * The source session id (non-empty string, not yet branded). */
  readonly sessionId: string
  /** 精确含边界的源事件序号；省略时取最近已完成轮次。
   * The exact inclusive source event seq; omit for the latest completed turn. */
  readonly atSeq?: number
  /** 新分支的预设 id；省略时继承源会话预设。
   * The preset id for the new branch; omitted inherits the source preset. */
  readonly presetId?: string
  /** 新分支的 provider 路由；与 model 必须同时出现。
   * The provider route for the new branch; required together with model. */
  readonly provider?: string
  /** 新分支的模型 id；与 provider 必须同时出现。
   * The model id for the new branch; required together with provider. */
  readonly model?: string
  /** 该路由的可选推理强度；需要 provider/model 同时在场。
   * The optional reasoning effort for that route; requires provider and model. */
  readonly reasoningEffort?: string
}

/**
 * 本工具追踪的模型选择视图：只含 provider、model 与可选 effort。
 * The model-selection view this tool tracks: provider, model, optional effort.
 */
export interface ModelSelectionView {
  /** Provider 路由 id。The provider route id. */
  readonly provider: string
  /** Provider 适配器解释的模型 id。The model id interpreted by the provider adapter. */
  readonly model: string
  /** 该路由的可选推理强度。The optional reasoning effort for that route. */
  readonly reasoningEffort?: string
}

/**
 * 分叉工具的返回值：新会话标识及其创建时使用的路由/预设。
 * The fork tool's value: the new session identity and the route/preset it was
 * created with.
 */
export interface ForkValue {
  /** 新会话 id。The new session id. */
  readonly sessionId: string
  /** 源会话 id。The source session id. */
  readonly sourceSessionId: string
  /** 实际使用的含边界源事件序号。The inclusive source boundary actually used. */
  readonly atSeq: number
  /** 子分支继承的事件数。The inherited event count. */
  readonly inheritedEventCount: number
  /** 新分支的预设 id（可能缺席）。The new branch's preset id, when any. */
  readonly agentPreset?: string
  /** 新分支的 provider 路由。The new branch's provider route. */
  readonly provider: string
  /** 新分支的模型 id。The new branch's model id. */
  readonly model: string
  /** 该路由的可选推理强度。The optional reasoning effort for that route. */
  readonly reasoningEffort?: string
}
