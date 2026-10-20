/**
 * @veren/app-registry 公共出口：默认导出 AppRegistryService（Service 插件）。
 * Public entry: default-exports AppRegistryService (a Service-class plugin).
 *
 * 挂载后消费方经 `inject: ['apps']` 拿到同一实例（部署级共享）。
 * @module @veren/app-registry
 */
import type { Context } from '@deepseek-ai/cordis'
import { AppRegistryService } from './service.ts'

export { APPS_NAME, AppRegistryService } from './service.ts'
export { AppRegistryError } from './errors.ts'
export { createBootstrapTools } from './bootstrap-tools.ts'
export type { BootstrapTools } from './bootstrap-tools.ts'
export * from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 应用注册表：应用插件注册应用/页面/工具，宿主引导工具 app_list/app_pages 消费。 */
    apps: AppRegistryService
  }
}

/** Loader 入口：服务类即插件（Service Definition）。 */
export default AppRegistryService
