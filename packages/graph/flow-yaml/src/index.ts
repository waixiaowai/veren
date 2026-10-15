/**
 * @veren/graph-flow-yaml —— YAML flow 定义加载插件。
 *
 * @veren/graph-flow-yaml — the YAML flow-definition loader plugin.
 *
 * 插件入口：按 Config.files 逐个读取 YAML 文件，经 @veren/yaml-parser 解析、
 * loader 校验映射，再注册进 FlowEngine；注册走 ctx.effect，随 fiber 卸载
 * 逆序注销。
 * The plugin entry: reads each YAML file from Config.files, parses it through
 * @veren/yaml-parser, validates and maps it with the loader, then registers
 * the flow into the FlowEngine via ctx.effect so fibers unregister in
 * reverse order.
 */

import { readFile } from 'node:fs/promises';
import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { defineToken, getOrThrow } from '@veren/core';
import { FlowEngineToken } from '@veren/graph-flow-engine';
import { name as YamlParserToken } from '@veren/yaml-parser';
import { flowFromYaml } from './loader.js';
import type { YamlFlowError } from './loader.js';

export { flowFromYaml, YamlFlowError } from './loader.js';

/** YAML 加载服务令牌（供测试与组合使用）/ the YAML loader service token (for tests and composition) */
export const FlowYamlLoaderToken = defineToken<FlowYamlLoader>('graphFlowYamlLoader');

/** 加载能力面 / the loading capability surface */
export interface FlowYamlLoader {
    /** 读取并注册一个 YAML flow 文件 / read and register one YAML flow file */
    loadFile(path: string): Promise<void>;
}

/** 插件配置：YAML flow 文件路径列表 / the plugin config: YAML flow file paths */
export interface Config {
    files: string[];
}

export const Config: z<Config> = z.object({
    files: z.array(z.string()).default([]),
});

/** 插件名 / the plugin name */
export const name = 'graphFlowYaml';
/** 依赖 flow 引擎与 YAML 解析能力 / requires the flow engine and the YAML parser capability */
export const inject = [FlowEngineToken, YamlParserToken] as const;
/** 提供 YAML 加载能力 / provides the YAML loading capability */
export const provide = [FlowYamlLoaderToken] as const;

export const apply = (ctx: Context, config: Config): void => {
    const engine = getOrThrow(ctx, FlowEngineToken);
    const parser = getOrThrow(ctx, YamlParserToken);
    const loadFile = async (path: string): Promise<void> => {
        const document = parser.parse(await readFile(path, 'utf8'));
        // 空 YAML（null）直接跳过 / an empty YAML document (null) is skipped
        if (document === null || document === undefined) return;
        const definition = flowFromYaml(document);
        await engine.registerFlow(definition);
        // 卸载时逆序注销 flow / unregister the flow in reverse order on unload
        ctx.effect(() => () => void engine.unregisterFlow(definition.id), `flow-yaml:${definition.id}`);
    };
    const loader: FlowYamlLoader = { loadFile };
    ctx.effect(() => ctx.provide(FlowYamlLoaderToken, loader), FlowYamlLoaderToken);
    // Config.files 静态装载：异步 effect 内顺序加载（await ctx.plugin 等待完成），
    // 单个失败记日志不阻断其余文件。
    // Static loads from Config.files run sequentially inside an async effect
    // (awaiting ctx.plugin waits for them); one failure logs without blocking the rest.
    ctx.effect(async () => {
        for (const file of config.files) {
            await loader.loadFile(file).catch((cause) => ctx.logger.error(`failed to load flow file ${file}`, cause));
        }
        return () => void 0;
    }, 'flow-yaml-files');
};
