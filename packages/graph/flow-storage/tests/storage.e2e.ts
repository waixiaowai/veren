/**
 * 真实存储 e2e：dsh storage hub + json 后端 + domain 层 + flow-storage
 * 全链路组合（临时目录，无凭据；失败自动重试 2 次）。
 *
 * Real-storage e2e: the full dsh storage hub + json backend + domain layer +
 * flow-storage composition on a temp dir (no credentials; retried twice).
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import { apply as kernelPlugin } from '@deepseek-ai/dsh-graph-core';
import { apply as enginePlugin, FlowEngineToken, FlowStorageToken } from '@deepseek-ai/dsh-graph-flow-engine';
import * as flowStorage from '../src/index.js';
import Storage from '@deepseek-ai/dsh-storage';
import * as storageJson from '@deepseek-ai/dsh-storage-json';
import * as storageDomain from '@deepseek-ai/dsh-storage-domain';

const dir = await mkdtemp(join(tmpdir(), 'veren-flow-storage-'));
afterAll(() => rm(dir, { recursive: true, force: true }));

async function makeStack() {
    const ctx = new Context();
    await ctx.plugin({ apply: (c: Context) => void new Storage(c) } as never);
    await ctx.plugin({ inject: storageJson.inject, apply: storageJson.apply } as never, { root: dir });
    await ctx.plugin({ inject: storageDomain.inject, apply: storageDomain.apply } as never, { backend: 'json' });
    const facility = (ctx as unknown as { storage: { domain?: unknown } }).storage.domain;
    expect(facility).toBeDefined();
    await ctx.plugin(kernelPlugin);
    await ctx.plugin({ inject: flowStorage.inject, apply: flowStorage.apply } as never, {});
    // FlowStorage 由异步 effect 提供，等待就绪 / FlowStorage arrives via an async effect; wait for it
    for (let i = 0; i < 50 && !ctx.get(FlowStorageToken); i++) {
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await ctx.plugin(enginePlugin as never, { nodeTimeoutMs: 5000 });
    return { ctx, engine: ctx.get(FlowEngineToken)! };
}

describe('flow storage e2e (real storage)', () => {
    it('persists flow definitions and run records to the json medium', async () => {
        const { engine } = await makeStack();
        await engine.registerFlow({
            id: 'e2e-flow',
            nodes: [{ id: 'e', type: 'echo', config: { message: 'persisted' } }],
            edges: [],
            output: { said: '${e.message}' },
        });
        const result = await engine.run('e2e-flow').awaitCompletion();
        expect(result.status).toBe('completed');
        expect(result.output['said']).toBe('persisted');
        // 中介上是真实文件 / the medium is a real file on disk
        const unitFile = join(dir, 'graph_flow.json');
        const raw = await readFile(unitFile, 'utf8');
        expect(raw).toContain('e2e-flow');
        expect(raw).toContain(result.runId);
    }, 30_000);
});
