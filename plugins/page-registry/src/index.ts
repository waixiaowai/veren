/**
 * @veren/page-registry 公共出口：默认导出 PageRegistryService（Service 插件）。
 * Public entry: default-exports PageRegistryService (a Service-class plugin).
 *
 * 挂载后消费方经 `inject: ['pageRegistry']` 拿到同一实例（部署级共享）。
 * 页面注册走应用作用域：页面 URL 统一 `/apps/<appId>/...`，由 app-registry 的
 * `ctx.apps.pages(id)` 注册面登记（页面注册改为应用作用域，§3.1、§8.1）；
 * `page.<name>` 预设的产生路径已废弃（buildPagePreset 仅为迁移期兼容保留）。
 * @module @veren/page-registry
 */
import type { Context } from '@deepseek-ai/cordis'
import { PageRegistryService } from './service.ts'

export { PAGE_REGISTRY_NAME, PageRegistryService } from './service.ts'
export { APP_PAGES_DOMAIN_NAME, appPagesDomain, instanceTableView } from './storage.ts'
export {
  PAGE_LOAD_TIMEOUT_MS, appIdOf, externalToolName, firstScreenData, instanceTitleOf, mountPreviewTools, openPageUrl,
} from './runtime.ts'
export type {
  DeliveryFace, MountedTool, OpenPageOptions, OpenPageResult, PageDataIdentity, PageDataPort,
  PagePreview, PageRuntimePorts, PageSessionPort, ToolsFace,
} from './runtime.ts'
export { createAppOpenTool, createPageSendTool } from './tools.ts'
export type { AppOpenPort, PageSendPort } from './tools.ts'
export { MAX_DELIVERY_ATTEMPTS, MAX_DELIVERY_HOPS, PAGE_SEND_SOURCE, deliverToPageUrl, HopLedger } from './delivery.ts'
export type { DeliverPageOptions, DeliveryResult } from './delivery.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 页面注册表 + URL 索引 + 页面运行时：页面注册、app_open、目录面板消费。 */
    pageRegistry: PageRegistryService
  }
}

/** Loader 入口：服务类即插件（Service Definition）。 */
export default PageRegistryService
