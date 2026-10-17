/**
 * flow 存储域声明：表结构 + zod 记录 schema（dsh domain 存储的持久边界校验）。
 *
 * The flow storage domain declaration: table layout plus zod record schemas
 * (validated at the dsh domain storage's durable boundary).
 */

import { z } from 'zod';
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain';
import type { FlowDefinition } from '@deepseek-ai/dsh-graph-flow-api';
import type { FlowRunResult } from '@deepseek-ai/dsh-graph-flow-engine';

/** 持久化的 flow 定义记录 / a persisted flow-definition record */
export interface FlowRecord {
    id: string;
    definition: FlowDefinition;
}

/** 持久化的运行记录 / a persisted run record */
export interface RunRecord {
    id: string;
    flowId: string;
    status: FlowRunResult['status'];
    startedAt: number;
    output: Record<string, unknown>;
    nodes: Record<string, unknown>;
    error?: { code: string; message: string };
}

/** 记录 schema（zod；宽松以容忍引擎版本演进）/ record schemas (zod; loose to tolerate engine evolution) */
const flowRecordSchema = z.object({
    id: z.string(),
    definition: z.custom<FlowDefinition>((value) => typeof value === 'object' && value !== null),
});

const runRecordSchema = z.object({
    id: z.string(),
    flowId: z.string(),
    status: z.enum(['completed', 'failed', 'cancelled']),
    startedAt: z.number(),
    output: z.record(z.string(), z.unknown()),
    nodes: z.record(z.string(), z.unknown()),
    error: z.object({ code: z.string(), message: z.string() }).optional(),
});

/**
 * 存储域：flows 表（定义）与 runs 表（运行记录）。
 * The storage domain: the flows table (definitions) and the runs table.
 */
export const flowDomain = defineDomain({
    name: 'graph_flow',
    version: 1,
    tables: {
        flows: domainTable<FlowRecord['id'], FlowRecord>(flowRecordSchema),
        runs: domainTable<RunRecord['id'], RunRecord>(runRecordSchema),
    },
});
