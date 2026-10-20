/**
 * @veren/page-registry 公共出口：默认导出 PageRegistryService（Service 插件）。
 * Public entry: default-exports PageRegistryService (a Service-class plugin).
 *
 * 挂载后消费方经 `inject: ['pageRegistry']` 拿到同一实例（部署级共享，
 * 会话子作用域经服务解析向上找到顶层实例）。
 * @module @veren/page-registry
 */
import type { Context } from '@deepseek-ai/cordis'
import { PageRegistryService } from './service.ts'

export { PAGE_REGISTRY_NAME, PageRegistryService } from './service.ts'
export type { PageRegistryService as PageRegistryServiceType } from './service.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 页面注册表：页面插件注册、导航入口与目录面板消费。 */
    pageRegistry: PageRegistryService
  }
}

/** Loader 入口：服务类即插件（Service Definition）。 */
export default PageRegistryService
