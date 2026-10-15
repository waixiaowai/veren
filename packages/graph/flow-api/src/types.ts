/**
 * flow 语义层最小 API 的类型面：节点插件只 import type 本文件，
 * 加上注入 NodeRegistryToken，禁止依赖实现包（@veren/graph-flow-engine）。
 *
 * The type surface of the minimal flow semantic-layer API: node plugins
 * import types from this file and inject NodeRegistryToken only; they must
 * never depend on the implementation package (@veren/graph-flow-engine).
 */

import type { Context } from '@deepseek-ai/cordis';
import type z from '@deepseek-ai/schemastery';

/** 品牌记号（零运行时开销）/ the brand mark (zero runtime overhead) */
declare const brand: unique symbol;
/** 跨边界 id 用品牌 / cross-boundary ids are branded strings */
export type Branded<B extends string> = string & { readonly [brand]?: B };

/** flow 定义 id / flow definition id */
export type FlowId = Branded<'FlowId'>;
/** 一次运行 id / one run id */
export type RunId = Branded<'RunId'>;
/** flow 节点 id / flow node id */
export type NodeId = Branded<'NodeId'>;

/**
 * slot 引用：形如 `${nodeId.slot}`，一期唯一支持的表达式。
 * A slot reference of the form `${nodeId.slot}` — the only expression
 * supported in phase one.
 */
export type SlotRef = `${string}.${string}`;

/** flow 级黑板契约：节点向命名 slot 写，下游按名读；边只表达依赖不传值 */
export interface FlowBlackboard {
    read(nodeId: string, slot: string): unknown;
    write(nodeId: string, slot: string, value: unknown): void;
    /** 全量快照（flow 事件携带）/ full snapshot (carried by flow events) */
    snapshot(): Record<string, unknown>;
}

/** 节点级失败策略（参照 n8n onError / Dify / Coze）；默认 failFast */
export type OnErrorPolicy = 'failFast' | 'fallback' | 'errorBranch';

/** 重试策略：tries 次尝试（含首次），间隔 backoffMs */
export interface RetryPolicy {
    tries: number;
    backoffMs?: number;
}

/** 一条 flow 边：只表达依赖顺序；port 指向命名输出端口（如 error） */
export interface FlowEdge {
    from: NodeId;
    to: NodeId;
    /** 沿名为 port 的输出端口继续；缺省为默认输出 / continue along the named output port; default port when omitted */
    port?: string;
    /** 条件谓词（内核在上游落定后求值）；false → 下游 skipped `upstream-condition` */
    when?: (blackboard: FlowBlackboard, ctx: Context) => boolean;
}

/** flow 节点声明 / one flow node declaration */
export interface FlowNodeDef {
    id: NodeId;
    /** 已注册的节点类型 / a registered node type */
    type: string;
    /** 固定引用的版本；缺省取已注册最新 / pinned version; latest registered when omitted */
    version?: number;
    /** 交由 handler.config（schemastery）校验 / validated against handler.config (schemastery) */
    config?: unknown;
    /** 显式输入映射：'${nodeId.slot}' 引用或字面量 / explicit input mapping: slot refs or literals */
    input?: Record<string, SlotRef | unknown>;
    /** 节点级失败策略；缺省 failFast，优先生效于内核全局策略 */
    onError?: OnErrorPolicy;
    /** onError 'fallback' 的声明式兜底输出 / the declarative fallback output for onError 'fallback' */
    fallbackValue?: unknown;
    retry?: RetryPolicy;
    /** 节点级超时（毫秒）；缺省取引擎 nodeTimeoutMs / per-node timeout (ms); engine default when omitted */
    timeout?: number;
}

/**
 * flow 定义：编译成内核 Graph。Start/End 签名：input 是 schemastery schema
 * （run() 校验入参），output 声明命名的输出变量（值是 slot 引用）。
 * A flow definition compiled into a kernel Graph. Start/End signatures:
 * input is a schemastery schema (validated by run()), output declares named
 * result variables as slot references.
 */
export interface FlowDefinition {
    id: FlowId;
    /** 入参 schema（schemastery）；缺省接受任意对象 / the input schema (schemastery); any object when omitted */
    input?: z<unknown>;
    /** 输出变量：名字 → '${nodeId.slot}' / output variables: name → slot ref */
    output?: Record<string, SlotRef>;
    nodes: FlowNodeDef[];
    edges: FlowEdge[];
}

/** 节点执行期上下文（节点作用域派生自 run 子 context）/ per-node execution context (node-scoped) */
export interface NodeExecuteContext {
    /** 节点作用域 ctx：run 子 context 经 isolate(nodeId) 派生 */
    ctx: Context;
    flowId: FlowId;
    runId: RunId;
    nodeId: NodeId;
    /** 当前尝试序号（重试从 1 起）/ current attempt (retries start at 1) */
    attempt: number;
    /** 已通过 handler.config 校验的节点配置 / the node config validated against handler.config */
    config: unknown;
    blackboard: FlowBlackboard;
    /** 统一取消通道 / the unified cancel channel */
    signal: AbortSignal;
}

/**
 * 节点类型 handler：config 用 schemastery 声明并校验；execute 返回命名
 * 输出 slot（对象），非对象返回值落在 `out` slot。
 * A node handler: config is declared and validated with schemastery; execute
 * returns named output slots (an object) — non-object returns land in `out`.
 */
export interface NodeHandler<TConfig = unknown, TInput = Record<string, unknown>> {
    readonly type: string;
    /** 节点类型版本（参照 n8n typeVersion），注册表按 (type, version) 索引 */
    readonly version: number;
    readonly config: z<TConfig>;
    execute(input: TInput, nctx: NodeExecuteContext): unknown | Promise<unknown>;
}

/**
 * 节点类型注册表：按 (type, version) 索引；register 返回 disposer，供
 * ctx.effect 实现卸载逆序清理 / HMR 安全。
 * The node-type registry indexed by (type, version); register returns a
 * disposer for ctx.effect so uninstall cleans up in reverse order (HMR-safe).
 */
export interface NodeRegistry {
    register(handler: NodeHandler): () => boolean;
    get(type: string, version?: number): NodeHandler | undefined;
    has(type: string): boolean;
    list(): ReadonlyArray<{ type: string; versions: readonly number[] }>;
}
