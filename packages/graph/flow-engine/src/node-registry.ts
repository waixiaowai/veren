/**
 * The node-type registry implementation: a two-level (type, version) index
 * with replace-on-re-register semantics for HMR reloads.
 *
 * 节点类型注册表实现：二级 (type, version) 索引，重复注册覆盖同版本（HMR 重载场景）。
 *
 * @module @deepseek-ai/dsh-graph-flow-engine/node-registry
 */

import type { NodeHandler, NodeRegistry } from '@deepseek-ai/dsh-graph-flow-api';

/** (type, version) 二级索引 / the two-level (type, version) index */
export class NodeRegistryImpl implements NodeRegistry {
    private readonly byType = new Map<string, Map<number, NodeHandler>>();

    /** 注册一个版本；重复注册覆盖同版本（HMR 重载场景）/ register one version; re-registering replaces it (HMR reloads) */
    register(handler: NodeHandler): () => boolean {
        let versions = this.byType.get(handler.type);
        if (!versions) {
            versions = new Map<number, NodeHandler>();
            this.byType.set(handler.type, versions);
        }
        versions.set(handler.version, handler);
        // 身份校验：旧 fiber 的 disposer 晚于新注册执行时不得删掉新 handler
        // Identity check: an old fiber's disposer running after a newer registration must not delete the new handler.
        return () => {
            const current = this.byType.get(handler.type);
            if (!current || current.get(handler.version) !== handler) return false;
            current.delete(handler.version);
            if (current.size === 0) this.byType.delete(handler.type);
            return true;
        };
    }

    /** 取指定版本或最新版本 / resolve a pinned version or the latest */
    get(type: string, version?: number): NodeHandler | undefined {
        const versions = this.byType.get(type);
        if (!versions) return undefined;
        if (version !== undefined) return versions.get(version);
        const latest = Math.max(...versions.keys());
        return versions.get(latest);
    }

    has(type: string): boolean {
        return this.byType.has(type);
    }

    /** 类型与已注册版本列表（诊断面）/ types with their registered versions (diagnostics) */
    list(): ReadonlyArray<{ type: string; versions: readonly number[] }> {
        return [...this.byType.entries()]
            .map(([type, versions]) => ({ type, versions: [...versions.keys()].sort((a, b) => a - b) }))
            .sort((a, b) => a.type.localeCompare(b.type));
    }
}
