/**
 * 应用的内嵌运行时记录与其对外只读投影：service 内部记账（AppEntry）与
 * 目录/消费方看到的视图（AppRecord）各只有一份定义。
 * The internal runtime record of an app and its read-only public projection:
 * the service's internal bookkeeping (AppEntry) and the catalog-facing view
 * (AppRecord) each have exactly one definition.
 *
 * @module @veren/app-registry/app-entry
 */
import type { Context } from '@deepseek-ai/cordis'
import type { PageRegistration } from './types.ts'
import type { AppRecord, ApplicationDefinition } from './types.ts'

/** 一条应用的内嵌运行时记录 / internal runtime record of one app */
export interface AppEntry {
  definition: ApplicationDefinition
  /** 注册时从 fiber 推导的提供包名 / owner package name derived from the fiber */
  owner: string
  /** 组合包版本快照（第 1 阶段占位）/ bundle version snapshot (placeholder in phase 1) */
  version: string
  /** 分配到的最终工具前缀 / assigned final tool prefix */
  toolPrefix: string
  state: 'active' | 'disabled' | 'broken'
  brokenReason?: string
  /** 注册方 fiber 上下文（归属校验 + 生命周期绑定）/ owning fiber context */
  ownerContext?: Context
  /** 已注册页面，键为应用内页面键 / registered pages keyed by app-internal page key */
  pages: Map<string, PageRegistration>
  /** 镜像注销器（应用级兜底，防止调用方丢弃 disposer）/ mirror disposers (app-level fallback) */
  mirrorDisposers: Array<() => void>
}

/** 内嵌记录 → 对外只读视图 / internal entry → the read-only public record */
export function toRecord(entry: AppEntry): AppRecord {
  return {
    definition: entry.definition,
    owner: entry.owner,
    version: entry.version,
    toolPrefix: entry.toolPrefix,
    state: entry.state,
    ...(entry.brokenReason === undefined ? {} : { brokenReason: entry.brokenReason }),
    // 页面投影（map 推导与规则 1 的事实源）：按访问重建，小应用零开销
    // / the page projection (the fact source for map derivation and rule 1): rebuilt per access, trivial for app-scale maps
    pages: new Map(
      [...entry.pages.entries()].map(([key, registered]) => [
        key,
        { url: registered.page.url, description: registered.page.description, component: registered.component ?? false },
      ]),
    ),
  }
}
