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
    constructor(
        ctx: Context,
        /** 需要投影的 flow 引擎 / the flow engine being projected */
        private readonly engine: FlowEngine,
    ) {
        super(ctx, FlowCanvasToken);
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
        return watchRun(this.ctx, this.engine, handle, listener);
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
