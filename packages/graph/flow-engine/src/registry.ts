/**
 * 节点类型注册表实现与内置最简节点（noop / fail / echo / subflow）。
 *
 * The node-type registry implementation and the built-in minimal node types
 * (noop / fail / echo / subflow).
 *
 * 内置节点只作为参考实现与集成测试夹具，不承载任何业务语义。
 * The built-ins are reference implementations and integration-test fixtures
 * only; they carry no business semantics.
 */

import z from '@deepseek-ai/schemastery';
import type { FlowId, NodeExecuteContext, NodeHandler, NodeRegistry } from '@veren/graph-flow-api';

/** (type, version) 二级索引 / the two-level (type, version) index */
export class NodeRegistryImpl implements NodeRegistry {
    private readonly byType = new Map<string, Map<number, NodeHandler>>();

    /** 注册一个版本；重复注册覆盖同版本（HMR 重载场景）/ register one version; re-registering replaces it (HMR reloads) */
    register(handler: NodeHandler): () => boolean {
        let versions = this.byType.get(handler.type);
        if (!versions) {
            versions = new Map<number, NodeHandler>();
            this.byType.set(handler.type, versions);
        }
        versions.set(handler.version, handler);
        return () => {
            if (!versions!.delete(handler.version)) return false;
            if (versions!.size === 0) this.byType.delete(handler.type);
            return true;
        };
    }

    /** 取指定版本或最新版本 / resolve a pinned version or the latest */
    get(type: string, version?: number): NodeHandler | undefined {
        const versions = this.byType.get(type);
        if (!versions) return undefined;
        if (version !== undefined) return versions.get(version);
        const latest = Math.max(...versions.keys());
        return versions.get(latest);
    }

    has(type: string): boolean {
        return this.byType.has(type);
    }

    /** 类型与已注册版本列表（诊断面）/ types with their registered versions (diagnostics) */
    list(): ReadonlyArray<{ type: string; versions: readonly number[] }> {
        return [...this.byType.entries()]
            .map(([type, versions]) => ({ type, versions: [...versions.keys()].sort((a, b) => a - b) }))
            .sort((a, b) => a.type.localeCompare(b.type));
    }
}

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
