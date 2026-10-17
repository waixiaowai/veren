/**
 * flow 存储契约测试：内存表替身覆盖 FlowStorage 能力面与引擎集成。
 * Flow storage contract tests: in-memory table doubles cover the FlowStorage
 * capability and its engine integration.
 */

import { describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { provideValue } from '@veren/core';
import { GraphKernelService } from '@deepseek-ai/dsh-graph-core';
import type { FlowRunResult, FlowStorage } from '@deepseek-ai/dsh-graph-flow-engine';
import { FlowEngineService, FlowStorageToken, NodeRegistryImpl as NodeRegistry } from '@deepseek-ai/dsh-graph-flow-engine';
import type { FlowDomainTables } from '../src/storage.js';
import { createDomainStorage } from '../src/storage.js';

/** 内存表替身 / an in-memory table double */
function fakeTables(): FlowDomainTables {
    const flows = new Map<string, unknown>();
    const runs = new Map<string, unknown>();
    return {
        flows: {
            get: (k) => flows.get(k) as never,
            put: async (k, v) => void flows.set(k, v),
            delete: async (k) => flows.delete(k),
            entries: () => flows.entries() as never,
        },
        runs: {
            get: (k) => runs.get(k) as never,
            put: async (k, v) => void runs.set(k, v),
            entries: () => runs.entries() as never,
        },
    } as never;
}

/** 带存储的引擎组合 / an engine wired with a storage double */
function makeEngine(storage: FlowStorage) {
    const ctx = new Context();
    const engine = new FlowEngineService(ctx, { nodeTimeoutMs: 5000 }, new GraphKernelService(ctx), new NodeRegistry(), storage);
    return engine;
}

const startedAt = new Map<string, number>();

describe('domain storage capability', () => {
    it('persists flows and runs and lists runs by start time', async () => {
        const tables = fakeTables();
        const storage = createDomainStorage(tables, (runId) => startedAt.get(runId) ?? 0);
        const engine = makeEngine(storage);
        await engine.registerFlow({
            id: 'stored',
            nodes: [{ id: 'e', type: 'echo', config: { message: 'hi' } }],
            edges: [],
        });
        expect(tables.flows.get('stored')).toMatchObject({ id: 'stored' });
        startedAt.set('r-later', 200);
        startedAt.set('r-earlier', 100);
        const result: FlowRunResult = await engine.run('stored').awaitCompletion();
        expect(tables.runs.get(result.runId)).toMatchObject({ id: result.runId, status: 'completed' });
        // listRuns 由存储侧提供（内存清单之外的持久化面）
        const summaries = await storage.listRuns();
        expect(summaries.map((s) => s.startedAt)).toEqual([...summaries.map((s) => s.startedAt)].sort((a, b) => a - b));
    });

    it('deleteFlow removes the definition', async () => {
        const tables = fakeTables();
        const storage = createDomainStorage(tables, () => 0);
        const engine = makeEngine(storage);
        await engine.registerFlow({ id: 'gone', nodes: [{ id: 'e', type: 'echo' }], edges: [] });
        expect(tables.flows.get('gone')).toBeDefined();
        await engine.unregisterFlow('gone');
        expect(tables.flows.get('gone')).toBeUndefined();
    });

    it('run persistence failures do not fail the run (logged)', async () => {
        const failing: FlowStorage = {
            saveFlow: async () => undefined,
            deleteFlow: async () => undefined,
            saveRun: async () => {
                throw new Error('disk full');
            },
            listRuns: async () => [],
        };
        const engine = makeEngine(failing);
        await engine.registerFlow({ id: 'ok', nodes: [{ id: 'e', type: 'echo' }], edges: [] });
        const result = await engine.run('ok').awaitCompletion();
        expect(result.status).toBe('completed');
    });

    it('picks up a FlowStorage provided after the engine mounts', async () => {
        // 典型组合顺序：引擎先装、flow-storage 的异步 effect 稍后才提供能力 /
        // Typical composition order: the engine mounts first and flow-storage's async effect provides the capability later.
        const ctx = new Context();
        const engine = new FlowEngineService(ctx, { nodeTimeoutMs: 5000 }, new GraphKernelService(ctx), new NodeRegistry());
        const tables = fakeTables();
        provideValue(ctx, FlowStorageToken, createDomainStorage(tables, () => 0));
        await engine.registerFlow({ id: 'late', nodes: [{ id: 'e', type: 'echo' }], edges: [] });
        expect(tables.flows.get('late')).toMatchObject({ id: 'late' });
        const result = await engine.run('late').awaitCompletion();
        expect(tables.runs.get(result.runId)).toMatchObject({ status: 'completed' });
    });
});
