/**
 * 画布数据源服务：静态投影 + 运行投影，作为 flow-engine 之上的一层薄适配。
 *
 * The canvas data-source service: static and run projections as a thin
 * adapter above flow-engine. It owns no graph logic and no layout data.
 */

import { Service, type Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { defineToken, getOrThrow } from '@veren/core';
import type { FlowDefinition, FlowId } from '@deepseek-ai/dsh-graph-flow-api';
import { FlowEngineToken } from '@deepseek-ai/dsh-graph-flow-engine';
import type { FlowEngine, FlowRunHandle, FlowRunOptions } from '@deepseek-ai/dsh-graph-flow-engine';
import { CanvasError, projectFlow } from './project.js';
import type {
    CanvasFlow,
    CanvasRunProjection,
    CanvasStatusListener,
    FlowCanvas,
} from './types.js';
import { watchRun } from './watch.js';

/** 画布数据源能力令牌 / the canvas data-source capability token */
export const FlowCanvasToken = defineToken<FlowCanvasService>('graphFlowCanvas');

/** 插件配置（当前无配置项）/ the plugin config (no options today) */
export interface FlowCanvasConfig {}

export const Config: z<FlowCanvasConfig> = z.object({});

export class FlowCanvasService extends Service implements FlowCanvas {
    /**
     * The context that owns this service's long-lived run listeners.
     *
     * Cordis rebinds `this.ctx` to the caller when a Remote/child context calls
     * a service view. Attaching `flow/node-status` listeners to that transient
     * context loses every change emitted by the parent engine as soon as the
     * call context is gone. The construction context is the stable owner.
     *
     * 服务长期运行监听器所属的 context。Cordis 在 Remote/子 context 调用服务视图时会把
     * `this.ctx` 重绑到调用方；把 `flow/node-status` 监听器挂到该瞬态 context 上，调用
     * context 一消失就会漏掉父引擎发出的所有变更。构造时的 context 才是稳定归属。
     */
    private readonly ownerCtx: Context;

    constructor(
        ctx: Context,
        /** 需要投影的 flow 引擎 / the flow engine being projected */
        private readonly engine: FlowEngine,
    ) {
        super(ctx, FlowCanvasToken);
        this.ownerCtx = ctx;
    }

    project(flowId: FlowId): CanvasFlow {
        const definition = this.engine.getFlow(flowId);
        if (!definition) {
            throw new CanvasError('CANVAS_FLOW_NOT_FOUND', `flow "${flowId}" is not registered`, { flowId });
        }
        return projectFlow(definition);
    }

    projectDefinition(definition: FlowDefinition): CanvasFlow {
        return projectFlow(definition);
    }

    watch(handle: FlowRunHandle, listener?: CanvasStatusListener): CanvasRunProjection {
        return watchRun(this.ownerCtx, this.engine, handle, listener);
    }

    run(flowId: FlowId, options?: FlowRunOptions, listener?: CanvasStatusListener): CanvasRunProjection {
        return this.watch(this.engine.run(flowId, options), listener);
    }
}

/** 插件名（即服务令牌）/ the plugin name (the service token) */
export const name = FlowCanvasToken;
/** 依赖 flow 引擎能力 / requires the flow-engine capability */
export const inject = [FlowEngineToken] as const;
/** 提供画布数据源能力 / provides the canvas data-source capability */
export const provide = [FlowCanvasToken] as const;

/** 插件入口：构造即注册 / the plugin entry: constructing registers the service */
export const apply = (ctx: Context, _config: FlowCanvasConfig = {}): void => {
    new FlowCanvasService(ctx, getOrThrow(ctx, FlowEngineToken));
};
