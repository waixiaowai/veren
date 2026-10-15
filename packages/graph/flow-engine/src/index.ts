/**
 * @veren/graph-flow-engine —— flow 语义层引擎。
 *
 * @veren/graph-flow-engine — the flow semantic-layer engine.
 *
 * 插件入口：提供 NodeRegistry 能力（节点插件注入注册）与 FlowEngine 能力
 * （yaml/storage 等外围插件注入使用）；FlowStorage 为可选能力，由
 * @veren/graph-flow-storage 提供。
 * The plugin entry: provides the NodeRegistry capability (node plugins
 * register into it) and the FlowEngine capability (consumed by the yaml and
 * storage plugins); FlowStorage is an optional capability provided by
 * @veren/graph-flow-storage.
 */

import type { Context } from '@deepseek-ai/cordis';
import { get, getOrThrow, provideValue } from '@veren/core';
import { GraphKernelToken } from '@veren/graph-core';
import { NodeRegistryToken } from '@veren/graph-flow-api';
import { Config, FlowEngineService, FlowEngineToken, FlowStorageToken } from './service.js';
import type { FlowEngineConfig } from './service.js';
import { NodeRegistryImpl } from './registry.js';

export { Config, FlowEngineService, FlowEngineToken, FlowStorageToken } from './service.js';
export type { FlowEngineConfig } from './service.js';
export {
    createBuiltinHandlers,
    createSubflowHandler,
    echoHandler,
    failHandler,
    noopHandler,
    NodeRegistryImpl,
} from './registry.js';
export type { SubflowRunner } from './registry.js';
export {
    compileFlow,
    createBlackboard,
    createRunner,
    flowError,
    FlowError,
    resolveInputValue,
    toFlowError,
    wrapGraphError,
} from './runtime.js';
export type { FlowErrorCode, OutcomePorts, RunnerDeps } from './runtime.js';
export type {
    CompiledFlow,
    FlowEngine,
    FlowNodeDefMap,
    FlowNodeRecord,
    FlowRunDetail,
    FlowRunEndPayload,
    FlowRunEventPayload,
    FlowRunHandle,
    FlowRunOptions,
    FlowRunResult,
    FlowRunStatus,
    FlowRunSummary,
    FlowStorage,
    FlowSummary,
} from './types.js';

/** 插件名（即 FlowEngine 服务令牌）/ the plugin name (the FlowEngine service token) */
export const name = FlowEngineToken;
/** 依赖内核能力 / requires the kernel capability */
export const inject = [GraphKernelToken] as const;
/** 提供 NodeRegistry 与 FlowEngine 能力 / provides the NodeRegistry and FlowEngine capabilities */
export const provide = [NodeRegistryToken, FlowEngineToken] as const;

/**
 * 插件入口：先提供注册表，再装配引擎（内置节点随引擎 fiber 卸载逆序注销）。
 * The plugin entry: provide the registry first, then wire the engine (built-in
 * nodes unregister in reverse order with the engine fiber).
 */
export const apply = (ctx: Context, config: FlowEngineConfig) => {
    const registry = new NodeRegistryImpl();
    const disposeRegistry = provideValue(ctx, NodeRegistryToken, registry);
    new FlowEngineService(ctx, Config(config), getOrThrow(ctx, GraphKernelToken), registry, get(ctx, FlowStorageToken));
    return disposeRegistry;
};
