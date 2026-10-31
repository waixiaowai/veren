/**
 * The built-in minimal node types: noop / fail / echo as reference
 * implementations and integration-test fixtures, plus the subflow type that
 * turns a flow into a node (its run callback is injected by the engine).
 *
 * 内置最简节点：noop / fail / echo 作为参考实现与集成测试夹具，以及把 flow 变成
 * 节点的 subflow 类型（运行回调由引擎注入）。
 *
 * @module @deepseek-ai/dsh-graph-flow-engine/builtin-nodes
 */

import z from '@deepseek-ai/schemastery';
import type { FlowId, NodeExecuteContext, NodeHandler } from '@deepseek-ai/dsh-graph-flow-api';

/** schemastery schema 宽化到 NodeHandler.config 槽位（注册表按 unknown 存储）/
    widen a schemastery schema into the NodeHandler.config slot (the registry stores unknown) */
const asConfig = (schema: unknown): NodeHandler['config'] => schema as NodeHandler['config'];

/** noop：透传输入（集成夹具）/ noop: passes its input through (integration fixture) */
export const noopHandler: NodeHandler = {
    type: 'noop',
    version: 1,
    config: asConfig(z.object({})),
    execute: (input) => input,
};

/** fail：抛错（fail-fast / retry / onError 夹具）/ fail: throws (fail-fast / retry / onError fixture) */
export const failHandler: NodeHandler = {
    type: 'fail',
    version: 1,
    config: asConfig(z.object({ message: z.string().default('node failed') })),
    execute: (_input, nctx) => {
        const { message } = nctx.config as { message: string };
        throw new Error(message);
    },
};

/** echo：把配置与输入回显为命名 slot（blackboard / waterfall 夹具）/ echo: echoes config and input into slots */
export const echoHandler: NodeHandler = {
    type: 'echo',
    version: 1,
    config: asConfig(z.object({ message: z.string().default('echo') })),
    execute: (input, nctx) => {
        const { message } = nctx.config as { message: string };
        return { out: input, message };
    },
};

/** subflow 运行回调（由引擎注入，避免 registry → engine 依赖）/ the subflow run callback (injected by the engine) */
export type SubflowRunner = (
    flowId: FlowId,
    input: Record<string, unknown>,
    nctx: NodeExecuteContext,
) => Promise<unknown>;

/**
 * subflow：flow 即节点，引用另一个 FlowId 递归组合。
 * The subflow type: a flow used as a node, referencing another FlowId for
 * recursive composition.
 */
export function createSubflowHandler(run: SubflowRunner): NodeHandler {
    return {
        type: 'subflow',
        version: 1,
        config: asConfig(z.object({ flow: z.string() })),
        execute: async (input, nctx) => {
            const { flow } = nctx.config as { flow: string };
            const result = await run(flow as FlowId, input, nctx);
            return { out: result };
        },
    };
}

/** 内置节点集合（服务装载时注册）/ the built-in handler set (registered when the service mounts) */
export function createBuiltinHandlers(runSubflow: SubflowRunner): NodeHandler[] {
    return [noopHandler, failHandler, echoHandler, createSubflowHandler(runSubflow)];
}
