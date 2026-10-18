/**
 * 运行登记与 SSE 传输：把画布运行投影变成可查询/可订阅的服务器侧记录。
 * Run registry and SSE transport: turn canvas run projections into queryable
 * and subscribable server-side records.
 *
 * This module owns transport details only; it never inspects kernel events.
 */

import type { ServerResponse } from 'node:http';
import type {
    CanvasNodeStatusChange,
    CanvasRunProjection,
    CanvasRunSnapshot,
    FlowCanvas,
} from '@deepseek-ai/dsh-graph-flow-canvas';
import type { RunStateMessage } from './model.js';

/** 单次运行最多保留的变更条数 / max changes kept per run */
const MAX_CHANGES = 200;
/** 内存中最多保留的运行数 / max runs kept in memory */
const MAX_RUNS = 40;

/** 一次运行的服务器侧记录 / server-side record of one run */
interface RunRecord {
    flowId: string;
    projection: CanvasRunProjection;
    changes: CanvasNodeStatusChange[];
    subscribers: Set<ServerResponse>;
    finished: boolean;
}

/** 运行登记表 / the run registry */
export class RunRegistry {
    private readonly runs = new Map<string, RunRecord>();

    constructor(
        private readonly canvas: FlowCanvas,
        private readonly onError: (error: unknown) => void,
    ) {}

    /** 启动一次运行并登记；返回 runId / start and register a run; returns its id */
    start(flowId: string): string {
        let record: RunRecord | undefined;
        const projection = this.canvas.run(flowId, {}, (change) => {
            if (!record) return;
            record.changes.push(change);
            if (record.changes.length > MAX_CHANGES) record.changes.shift();
            for (const subscriber of [...record.subscribers]) writeEvent(subscriber, 'node', change);
        });
        record = { flowId, projection, changes: [], subscribers: new Set(), finished: false };
        this.runs.set(projection.runId, record);
        this.prune();
        void projection.finished.then(() => {
            const current = this.runs.get(projection.runId);
            if (!current) return;
            current.finished = true;
            for (const subscriber of [...current.subscribers]) {
                writeEvent(subscriber, 'finished', this.stateOf(current));
                subscriber.end();
            }
            current.subscribers.clear();
        }).catch((error: unknown) => {
            this.onError(error);
            const current = this.runs.get(projection.runId);
            if (!current) return;
            current.finished = true;
            for (const subscriber of [...current.subscribers]) subscriber.end();
            current.subscribers.clear();
        });
        return projection.runId;
    }

    /** 查询一次运行的状态；未知返回 undefined / read one run; undefined when unknown */
    get(runId: string): RunStateMessage | undefined {
        const record = this.runs.get(runId);
        return record ? this.stateOf(record) : undefined;
    }

    /** 挂上 SSE；未知 run 返回 false / attach SSE; false for an unknown run */
    attach(runId: string, response: ServerResponse): boolean {
        const record = this.runs.get(runId);
        if (!record) return false;
        response.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
        });
        response.write('retry: 1500\n\n');
        writeEvent(response, 'state', this.stateOf(record));
        if (record.finished) {
            writeEvent(response, 'finished', this.stateOf(record));
            response.end();
            return true;
        }
        record.subscribers.add(response);
        const heartbeat = setInterval(() => {
            if (!response.writableEnded) response.write(': ping\n\n');
        }, 15_000);
        heartbeat.unref();
        response.on('close', () => {
            clearInterval(heartbeat);
            record.subscribers.delete(response);
        });
        return true;
    }

    /** 关闭所有订阅与投影 / close every subscriber and projection */
    dispose(): void {
        for (const record of this.runs.values()) {
            for (const subscriber of record.subscribers) subscriber.end();
            record.subscribers.clear();
            record.projection.dispose();
        }
        this.runs.clear();
    }

    /** 一次运行的可发送状态 / the sendable state of one run */
    private stateOf(record: RunRecord): RunStateMessage {
        const snapshot: CanvasRunSnapshot = record.projection.snapshot();
        return { snapshot, changes: [...record.changes], finished: record.finished };
    }

    /** 只保留最近的若干次运行 / keep only the most recent runs */
    private prune(): void {
        if (this.runs.size <= MAX_RUNS) return;
        for (const [runId, record] of this.runs) {
            if (this.runs.size <= MAX_RUNS) break;
            if (!record.finished) continue;
            this.runs.delete(runId);
        }
    }
}

/** 发送 SSE 事件 / write one SSE event */
function writeEvent(response: ServerResponse, event: string, payload: unknown): void {
    if (response.writableEnded) return;
    let body: string;
    try {
        body = JSON.stringify(payload);
    } catch (error) {
        body = JSON.stringify({ error: error instanceof Error ? error.message : String(error) });
    }
    response.write(`event: ${event}\ndata: ${body}\n\n`);
}
