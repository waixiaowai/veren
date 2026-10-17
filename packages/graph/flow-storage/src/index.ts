/**
 * @deepseek-ai/dsh-graph-flow-storage —— flow 定义与运行记录持久化插件。
 *
 * @deepseek-ai/dsh-graph-flow-storage — persistence for flow definitions and run
 * records.
 *
 * 插件入口：在 dsh storage hub 上打开 graph-flow 域（后端路由由
 * storage-domain 插件的 Config 决定），提供引擎的 FlowStorage 能力；
 * 关闭随 fiber 卸载自动执行。
 * The plugin entry: opens the graph-flow domain on the dsh storage hub
 * (backend routing is decided by the storage-domain plugin's Config) and
 * provides the engine's FlowStorage capability; closing runs automatically
 * when the fiber unloads.
 */

import type { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import { FlowStorageToken } from '@deepseek-ai/dsh-graph-flow-engine';
import type { DomainFacility } from '@deepseek-ai/dsh-storage-domain';
import { flowDomain } from './domain.js';
import type { FlowDomainTables } from './storage.js';
import { createDomainStorage, tablesOf } from './storage.js';

export { flowDomain } from './domain.js';
export type { FlowRecord, RunRecord } from './domain.js';
export { createDomainStorage, tablesOf } from './storage.js';
export type { FlowDomainTables } from './storage.js';

/** FlowStorage 能力令牌的再导出（组合方直接注入）/ re-export of the FlowStorage token */
export { FlowStorageToken };

/** 插件配置 / the plugin config */
export interface Config {
    /** 预留：启动时把已持久化的定义重新注册进引擎 / reserved: re-register persisted definitions into the engine at startup */
    restoreFlows?: boolean;
}

export const Config: z<Config> = z.object({ restoreFlows: z.boolean().default(false) });

/** 插件名 / the plugin name */
export const name = 'graphFlowStorage';
/** 依赖 dsh domain 数据设施（ctx.storageDomain）/ requires the dsh domain facility (ctx.storageDomain) */
export const inject = ['storageDomain'] as const;
/** 提供 FlowStorage 能力 / provides the FlowStorage capability */
export const provide = [FlowStorageToken] as const;

export const apply = (ctx: Context, config: Config): void => {
    const facility = ctx.storageDomain;
    if (!facility) {
        throw Object.assign(
            new Error(
                'storage-domain facility is missing; load @deepseek-ai/dsh-storage-domain first / 缺少 storage-domain 设施，请先装载',
            ),
            { code: 'STORAGE_DOMAIN_MISSING' },
        );
    }
    ctx.effect(async () => {
        const domain = await facility.open(flowDomain);
        const startedAt = new Map<string, number>();
        const tables = tablesOf(domain as never);
        const storage = createDomainStorage(tables, (runId) => startedAt.get(runId) ?? Date.now());
        ctx.effect(() => ctx.provide(FlowStorageToken, storage), FlowStorageToken);
        // 关闭随 fiber 卸载 / closing rides the fiber unload
        return () => void domain.close();
    }, 'graph-flow-domain');
    void config;
};
