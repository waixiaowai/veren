/**
 * flow 引擎测试的共享夹具：最小引擎组合、计数失败 handler、延时与放行信号。
 * 每个用例自建 Context，保证并发安全（单独跑才过 = 缺陷）。
 *
 * Shared fixtures for the flow-engine tests: the minimal engine stack, a
 * counting flaky handler, sleeps and one-shot gates. Every case builds its own
 * Context so specs stay concurrency-safe.
 */

import { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { GraphKernelService } from '@deepseek-ai/dsh-graph-core';
import type { NodeHandler } from '@deepseek-ai/dsh-graph-flow-api';
import { FlowEngineService } from '../src/index.js';
import { NodeRegistryImpl } from '../src/registry.js';

/** 构建"内核 + 注册表 + 引擎"的最小组合 / build a minimal kernel + registry + engine stack */
export function makeEngine(config: { nodeTimeoutMs?: number } = {}) {
    const ctx = new Context();
    const kernel = new GraphKernelService(ctx);
    const registry = new NodeRegistryImpl();
    const engine = new FlowEngineService(ctx, { nodeTimeoutMs: config.nodeTimeoutMs ?? 5000 }, kernel, registry);
    return { ctx, kernel, registry, engine };
}

/**
 * 计数失败 handler：前 failTimes 次尝试抛错，之后按 nctx.attempt 成功。
 * A counting flaky handler: the first failTimes attempts throw, later attempts
 * succeed and report the real attempt number from nctx.
 */
export function flakyHandler(attempts: number[], failTimes = 2): NodeHandler {
    return {
        type: 'flaky',
        version: 1,
        config: z.object({}) as NodeHandler['config'],
        execute: (_input, nctx) => {
            attempts.push(nctx.attempt);
            if (nctx.attempt <= failTimes) throw new Error('flaky');
            return { attempt: nctx.attempt };
        },
    };
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 一次性放行信号（测试用）/ a one-shot gate for tests */
export function gate(): { promise: Promise<void>; open: () => void } {
    let open!: () => void;
    const promise = new Promise<void>((resolve) => { open = resolve; });
    return { promise, open };
}

/** 慢节点（忽略 signal，自然跑完）/ a slow node that ignores the signal and finishes naturally */
export const slowHandler: NodeHandler = {
    type: 'slow',
    version: 1,
    config: z.object({}) as NodeHandler['config'],
    execute: () => sleep(80).then(() => ({ done: true })),
};

/** 慢失败节点：兄弟已启动后失败 / a slow-failing node: fails after the sibling has started */
export const slowFailHandler: NodeHandler = {
    type: 'slowFail',
    version: 1,
    config: z.object({}) as NodeHandler['config'],
    execute: () => sleep(10).then(() => { throw new Error('branch failed'); }),
};
