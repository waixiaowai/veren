/**
 * YAML → FlowDefinition 映射与结构校验（fails loud）。
 *
 * YAML → FlowDefinition mapping with loud shape validation.
 *
 * 一期 YAML 面向声明式子集：id / nodes(type, config, input, retry, timeout,
 * onError, fallbackValue) / edges(from, to, port) / output(slot 引用)。
 * 节点 config schema 与入参 schema 是运行时对象，不进 YAML；校验由引擎
 * 编译期完成（NODE_TYPE_NOT_FOUND / NODE_CONFIG_INVALID / FLOW_CYCLE_*）。
 * The phase-one YAML surface is the declarative subset: id / nodes / edges /
 * output. Handler config schemas and the input schema are runtime objects and
 * stay out of YAML; validation happens at engine compile time.
 */

import type { FlowDefinition, FlowEdge, FlowId, NodeId } from '@deepseek-ai/dsh-graph-flow-api';

/** YAML 结构错误（稳定 code + 定位字段）/ a YAML shape error (stable code plus locating fields) */
export class YamlFlowError extends Error {
    readonly code = 'FLOW_YAML_INVALID';
    readonly detail?: string;
    constructor(message: string, detail?: string) {
        super(message);
        this.name = 'YamlFlowError';
        this.detail = detail;
    }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

/** 校验并映射单个 flow 文档 / validate and map one flow document */
export function flowFromYaml(document: unknown): FlowDefinition {
    if (!isRecord(document)) throw new YamlFlowError('flow document must be a mapping / flow 文档必须是映射');
    const id = document['id'];
    if (typeof id !== 'string' || id.length === 0) {
        throw new YamlFlowError('flow "id" is required / flow 需要 id 字段', String(id));
    }
    const nodes = expectArray(document['nodes'], 'nodes');
    const edges = document['edges'] === undefined ? [] : expectArray(document['edges'], 'edges');
    const output = document['output'] === undefined ? undefined : expectRecord(document['output'], 'output');
    return {
        id: id as FlowId,
        output: output as FlowDefinition['output'],
        nodes: nodes.map(mapNode),
        edges: edges.map(mapEdge),
    };
}

/** 节点映射 / node mapping */
function mapNode(raw: unknown, index: number): FlowDefinition['nodes'][number] {
    if (!isRecord(raw)) throw new YamlFlowError(`nodes[${index}] must be a mapping / 节点必须是映射`);
    const { id, type } = raw;
    if (typeof id !== 'string' || typeof type !== 'string') {
        throw new YamlFlowError(`nodes[${index}] needs string "id" and "type" / 节点需要字符串 id 与 type`);
    }
    const retry = isRecord(raw['retry'])
        ? {
              tries: Number(raw['retry']['tries'] ?? 1),
              backoffMs: raw['retry']['backoffMs'] === undefined ? undefined : Number(raw['retry']['backoffMs']),
          }
        : undefined;
    return {
        id: id as NodeId,
        type,
        version: raw['version'] === undefined ? undefined : Number(raw['version']),
        config: raw['config'],
        input: raw['input'] as FlowDefinition['nodes'][number]['input'],
        onError: raw['onError'] as FlowDefinition['nodes'][number]['onError'],
        fallbackValue: raw['fallbackValue'],
        retry,
        timeout: raw['timeout'] === undefined ? undefined : Number(raw['timeout']),
    };
}

/** 边映射 / edge mapping */
function mapEdge(raw: unknown, index: number): FlowEdge {
    if (!isRecord(raw)) throw new YamlFlowError(`edges[${index}] must be a mapping / 边必须是映射`);
    const { from, to } = raw;
    if (typeof from !== 'string' || typeof to !== 'string') {
        throw new YamlFlowError(`edges[${index}] needs string "from" and "to" / 边需要字符串 from 与 to`);
    }
    return { from: from as NodeId, to: to as NodeId, port: typeof raw['port'] === 'string' ? raw['port'] : undefined };
}

function expectArray(value: unknown, field: string): unknown[] {
    if (!Array.isArray(value)) throw new YamlFlowError(`"${field}" must be a list / ${field} 必须是列表`);
    return value;
}

function expectRecord(value: unknown, field: string): Record<string, unknown> {
    if (!isRecord(value)) throw new YamlFlowError(`"${field}" must be a mapping / ${field} 必须是映射`);
    return value;
}
