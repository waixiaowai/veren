/**
 * DomainFlowStorage：把引擎的 FlowStorage 能力落到 dsh domain 存储的两张表。
 *
 * DomainFlowStorage: implements the engine's FlowStorage capability on two
 * tables of a dsh domain storage.
 */

import type { Domain } from '@deepseek-ai/dsh-storage-domain';
import type { FlowDefinition, FlowId } from '@deepseek-ai/dsh-graph-flow-api';
import type { FlowRunResult, FlowRunSummary, FlowStorage } from '@deepseek-ai/dsh-graph-flow-engine';
import type { FlowRecord, RunRecord } from './domain.js';

/** 领域表句柄的最小形状（便于测试替身）/ minimal table shape (keeps test doubles easy) */
export interface FlowDomainTables {
    flows: {
        get(key: string): FlowRecord | undefined;
        put(key: string, value: FlowRecord): Promise<void>;
        delete(key: string): Promise<boolean>;
        entries(): IterableIterator<[string, FlowRecord]>;
    };
    runs: {
        get(key: string): RunRecord | undefined;
        put(key: string, value: RunRecord): Promise<void>;
        entries(): IterableIterator<[string, RunRecord]>;
    };
}

/** 从打开的 Domain 提取表句柄 / extract the table handles from an opened Domain */
export function tablesOf(domain: Domain<never>): FlowDomainTables {
    return {
        flows: domain.table('flows') as unknown as FlowDomainTables['flows'],
        runs: domain.table('runs') as unknown as FlowDomainTables['runs'],
    };
}

/** 运行结果 → 持久化记录 / run result → persisted record */
function toRunRecord(result: FlowRunResult, startedAt: number): RunRecord {
    return {
        id: result.runId,
        flowId: result.flowId,
        status: result.status,
        startedAt,
        output: result.output,
        nodes: result.nodes,
        error: result.error,
    };
}

/** 基于 domain 表的 FlowStorage 实现 / the FlowStorage implementation over domain tables */
export function createDomainStorage(tables: FlowDomainTables, startedAtOf: (runId: string) => number): FlowStorage {
    return {
        async saveFlow(definition: FlowDefinition): Promise<void> {
            await tables.flows.put(definition.id, { id: definition.id, definition });
        },
        async deleteFlow(flowId: FlowId): Promise<void> {
            await tables.flows.delete(flowId);
        },
        async saveRun(result: FlowRunResult): Promise<void> {
            const record: RunRecord = toRunRecord(result, startedAtOf(result.runId));
            await tables.runs.put(result.runId, record);
        },
        async listRuns(): Promise<FlowRunSummary[]> {
            const summaries: FlowRunSummary[] = [];
            for (const [, record] of tables.runs.entries()) {
                summaries.push({
                    flowId: record.flowId as FlowId,
                    runId: record.id as FlowRunSummary['runId'],
                    status: record.status,
                    startedAt: record.startedAt,
                });
            }
            return summaries.sort((a, b) => a.startedAt - b.startedAt);
        },
    };
}
