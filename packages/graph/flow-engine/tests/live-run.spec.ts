/**
 * 运行中读取面测试：getRun 在运行中给出实时逐节点状态；终态记录省略
 * 缺失的可选字段（`'error' in node` 必须为 false，而不是 error: undefined）。
 *
 * Live read-surface tests: getRun exposes real-time per-node states while a
 * run is in flight, and terminal records omit absent optional fields
 * (`'error' in node` must be false, not error: undefined).
 */

import { describe, expect, it } from 'vitest';
import z from '@deepseek-ai/schemastery';
import type { NodeHandler } from '@deepseek-ai/dsh-graph-flow-api';
import { gate, makeEngine } from './helpers.js';

describe('flow run live state', () => {
    it('exposes completed/running nodes through getRun and omits absent optional keys', async () => {
        const { engine, registry } = makeEngine();
        const started = gate();
        registry.register({
            type: 'hold',
            version: 1,
            config: z.object({}) as NodeHandler['config'],
            execute: (_input, nctx) => new Promise((resolve) => {
                started.open();
                nctx.signal.addEventListener('abort', () => resolve('done'), { once: true });
            }),
        });
        await engine.registerFlow({
            id: 'live-state',
            nodes: [{ id: 'a', type: 'noop' }, { id: 'b', type: 'hold' }],
            edges: [{ from: 'a', to: 'b' }],
        });

        const handle = engine.run('live-state');
        await started.promise;
        const live = engine.getRun(handle.runId)!;
        expect(live.status).toBe('running');
        expect(live.nodes['a']!.status).toBe('completed');
        expect(live.nodes['b']!.status).toBe('running');
        expect(live.nodes['b']!.startedAt).toBeTypeOf('number');
        expect('error' in live.nodes['a']!).toBe(false);
        expect('skipReason' in live.nodes['a']!).toBe(false);
        expect(live.result).toBeUndefined();

        handle.cancel();
        const result = await handle.awaitCompletion();
        expect(result.nodes['a']!.status).toBe('completed');
        expect(result.nodes['b']!.status).toBe('cancelled');
        const done = engine.getRun(handle.runId)!;
        expect(done.status).toBe('cancelled');
        expect(done.nodes['b']!.status).toBe('cancelled');
        // 终态同样省略 undefined / terminal records omit undefined too
        expect('error' in done.nodes['a']!).toBe(false);
        expect('error' in done.nodes['b']!).toBe(false);
        expect('skipReason' in done.nodes['a']!).toBe(false);
        expect('error' in result).toBe(false);
    });
});
