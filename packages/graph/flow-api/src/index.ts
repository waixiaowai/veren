/**
 * flow 层运行时令牌与注册帮助函数。
 *
 * Flow-layer runtime tokens and the registration helper.
 *
 * 节点插件从这里拿 NodeRegistryToken（能力注入），用 registerNodeHandler 把
 * handler 挂进 ctx.effect，保证卸载逆序清理 / HMR 安全。
 * Node plugins take NodeRegistryToken from here (capability injection) and
 * wrap registerNodeHandler in ctx.effect so uninstall cleans up in reverse
 * order (HMR-safe).
 */

import type { Context } from '@deepseek-ai/cordis';
import { defineToken, getOrThrow } from '@veren/core';
import type { NodeHandler, NodeRegistry } from './types.js';

// 类型面整体再导出：节点插件只 import 本包即可拿到全部类型。
// Re-export the whole type surface: node plugins get every type from this package.
export type {
    Branded,
    FlowId,
    RunId,
    NodeId,
    SlotRef,
    FlowBlackboard,
    OnErrorPolicy,
    RetryPolicy,
    FlowEdge,
    FlowNodeDef,
    FlowDefinition,
    NodeExecuteContext,
    NodeHandler,
    NodeRegistry,
} from './types.js';

/** 节点类型注册表令牌 / the node-type registry token */
export const NodeRegistryToken = defineToken<NodeRegistry>('graphNodeRegistry');

/**
 * 注册一个节点类型 handler：经 ctx.effect 挂载，fiber 卸载时逆序注销。
 * Register one node-type handler through ctx.effect; the fiber unregisters
 * it in reverse order on unload.
 *
 * @param ctx 插件上下文 / the plugin context
 * @param handler 节点类型实现 / the node-type implementation
 * @returns 注销 disposer（异步完成）/ the unregistering disposer (async settle)
 */
export function registerNodeHandler(ctx: Context, handler: NodeHandler): () => Promise<void> {
    const registry = getOrThrow(ctx, NodeRegistryToken);
    const label = `node:${handler.type}@${handler.version}`;
    const disposer = ctx.effect(() => registry.register(handler), label);
    return () => disposer();
}
