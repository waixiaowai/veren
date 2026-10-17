/**
 * 内核测试的共享夹具：纯内存 executor 与图构造帮助函数。
 * Shared fixtures for the kernel tests: an in-memory executor and graph builders.
 */

import type { GExecutor, Graph } from '../src/index.js';

/** 记录执行轨迹的内存 executor / an in-memory executor that records a trace */
export function traceExecutor(trace: string[], opts: { delay?: number } = {}): GExecutor {
    return {
        async execute(node) {
            trace.push(`start:${node.id}`);
            if (opts.delay) await new Promise((resolve) => setTimeout(resolve, opts.delay));
            trace.push(`end:${node.id}`);
            return { from: node.id };
        },
    };
}

/** 单节点 + 依赖的线性图 / a linear graph of one node plus its dependencies */
export const line = (id: string, deps: string[]): Graph => ({
    id: 'g',
    nodes: [id, ...deps].map((nid) => ({ id: nid })),
    edges: deps.map((from) => ({ from, to: id })),
});
