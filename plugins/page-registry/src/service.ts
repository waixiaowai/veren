/**
 * PageRegistryService：页面注册表的宿主服务（Service 插件提供方）。
 * PageRegistryService: the host-level service owning the page registry.
 *
 * 能力接缝三角色：
 * - Service Definition（本文件）：register/resolve/catalog/get 契约
 * - Service Provider（默认导出的本服务类）：页面插件经 ctx.pageRegistry 注册
 * - Consumer：页面插件、导航入口、目录面板 inject ['pageRegistry']
 *
 * 注册表是部署级共享状态：顶层作用域挂载，会话子作用域经 inject 解析到同一实例。
 */
import { Service } from '@deepseek-ai/cordis'
import type { Context } from '@deepseek-ai/cordis'
import { PageRegistry, formatPath } from '@veren/prompt-page'
import type { PageCatalogEntry, PageDefinition, PageMatch, PageParams } from '@veren/prompt-page'

/** 服务名（ctx.pageRegistry / inject 'pageRegistry'）/ service name */
export const PAGE_REGISTRY_NAME = 'pageRegistry'

/**
 * 页面注册表服务：register 以 disposer 收口（HMR/卸载安全），卸载时整体清空。
 * resolve/get 以泛型转发（消费方声明自己的 state 类型；信任类型边界，不做运行时收窄）。
 */
export class PageRegistryService extends Service {
  private readonly registry = new PageRegistry<unknown>()

  /**
   * @param ctx - 宿主上下文 / host context
   */
  constructor(ctx: Context) {
    super(ctx, PAGE_REGISTRY_NAME)
  }

  /** 注册页面；重名/URL 模式冲突 fail loud；返回 disposer / register with a disposer */
  register(page: PageDefinition<never>): () => void {
    return this.registry.register(page as PageDefinition<unknown>)
  }

  /** 解析 URL：路径参数 + query 合并（path 优先）/ resolve a url to a page match */
  resolve<S>(url: string): PageMatch<S> | null {
    return this.registry.resolve(url) as PageMatch<S> | null
  }

  /** 按名取页面定义 / look up a page definition by name */
  get<S>(name: string): PageDefinition<S> | undefined {
    return this.registry.get(name) as PageDefinition<S> | undefined
  }

  /** 目录清单（入口/面板渲染）/ catalog entries */
  catalog(): PageCatalogEntry[] {
    return this.registry.catalog()
  }

  /** 参数工具：路径模式 + 参数 → 具体 URL / format a concrete url from a pattern */
  format(pattern: string, params: PageParams): string {
    return formatPath(pattern, params)
  }
}
