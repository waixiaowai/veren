/**
 * @veren/crawler 插件入口：装配「多平台内容采集」插件。
 * The @veren/crawler plugin entry: assembles the multi-platform content
 * crawler.
 *
 * 集成形态（按宿主惯例，存储只认宿主 storageDomain）：控制 API 挂在宿主
 * web 服务器上（不启动独立端口）；采集在宿主进程内运行（存储域访问要求）；
 * 浏览器 CDP 接管优先。
 * Integration shape (per host conventions, storage = the host storageDomain
 * only): the control api rides the host web server (no standalone port);
 * crawls run in-process (the storage domain requires it); the browser
 * attaches over CDP first.
 *
 * @module @veren/crawler
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-tools'
import type {} from '@veren/app-registry'
import type {} from '@veren/page-registry'
import { Config, resolveConfig } from './config.ts'
import type { RuntimeConfig } from './config.ts'
import { CrawlerManager } from './control/manager.ts'
import { ControlApi } from './control/http-server.ts'
import { createInProcessRunner } from './runner/inprocess-runner.ts'
import { realDeps } from './runner/real-deps.ts'
import { crawlFinishedNotifier } from './notice.ts'
import { CRAWLER_DOMAIN_NAME, crawlerDomain, type CrawlerStore } from './store/domain.ts'
import { bindToolPort, createCrawlerTools } from './tools.ts'
import { bindOverviewRuntime, provideToolStubs, OverviewPage, OverviewMeta } from './page-overview.tsx'
import { APP_DEFINITION, APP_ID } from './app.ts'

export { Config } from './config.ts'

export const name = 'veren-crawler'

/** 宿主服务全显式声明（G13）：web 服务器、存储域、工具表与应用注册表 / all host services declared explicitly (G13): web server, storage domain, tools, app registry */
export const inject = ['webServer', 'storageDomain', 'tools', 'apps']
export const provide = []

/** 装配好的控制面 / the assembled control faces */
export interface CrawlerRuntime {
  /** 已解析配置 / the resolved configuration */
  readonly config: RuntimeConfig
  /** 任务管理器（进程内单例）/ the task manager (in-process singleton) */
  readonly manager: CrawlerManager
  /** 已打开的宿主存储域 / the opened host storage domain */
  domain: CrawlerStore | undefined
}

/**
 * 装配本插件：解析配置 → 打开存储域 → 任务管理器（进程内运行器）→ 工具 →
 * 应用与页面 → 控制API挂宿主 → 卸载逆序清理。
 * Assembles the plugin: resolve config → open the storage domain → task
 * manager (in-process runner) → tools → app and pages → control api on the
 * host webServer → reverse-order dispose on unload.
 *
 * @param ctx - 宿主上下文 / the host context
 * @param config - 已校验的插件配置 / the validated plugin configuration
 */
export const apply = async (ctx: Context, config: Config): Promise<void> => {
  const domain = await openCrawlerDomain(ctx)
  const runtime = buildRuntime(ctx, config, domain)
  // 工具面：`crawler__<本地名>` 全名注册，disposer 逆序即卸（意见 4）。
  // The tool face: registered under `crawler__<localName>` full names;
  // reverse-order dispose unregisters (directive 4).
  bindToolPort({ manager: runtime.manager, domain: () => runtime.domain })
  // 页面挂载用同一组全名工具（意见 5）：组件体在唯一一次渲染里登记。
  // The page mounts the same full-name tools (directive 5): the body
  // registers them in its one render.
  provideToolStubs(createCrawlerTools().map((tool) => ({ ...tool, name: `crawler__${tool.name}` })))
  bindOverviewRuntime({ manager: runtime.manager, domain: () => runtime.domain })
  ctx.effect(() => createCrawlerTools().map((tool) => ctx.tools.register({ ...tool, name: `crawler__${tool.name}` })), 'veren-crawler:tools')
  registerAppAndPages(ctx)
  const api = new ControlApi({ manager: runtime.manager, domain: () => runtime.domain })
  ctx.effect(() => api.register(ctx), 'veren-crawler:api')
  ctx.effect(() => async () => {
    if (runtime.manager.status().status === 'running' || runtime.manager.status().status === 'starting') {
      await runtime.manager.stop()
    }
    await domain.close()
    runtime.domain = undefined
    ctx.logger.info('[veren-crawler] runtime disposed')
  }, 'veren-crawler:runtime')
  ctx.logger.info('[veren-crawler] control api mounted on host web server')
}

/**
 * 打开存储域；上一次激活留下的句柄先关掉（zhihu-ops 同款语义）。
 * Open the storage domain; a handle left by a previous activation closes
 * first (same semantics as zhihu-ops).
 */
async function openCrawlerDomain(ctx: Context): Promise<CrawlerStore> {
  const stale = ctx.storageDomain.get(CRAWLER_DOMAIN_NAME)
  if (stale !== undefined) {
    try {
      await stale.close()
    } catch (error: unknown) {
      ctx.logger.warn('[veren-crawler] previous storage domain could not close: %s', String(error))
    }
  }
  return ctx.storageDomain.open(crawlerDomain)
}

/** 装配运行时：配置解析 + 进程内执行器 + 任务管理器。 / Assemble the runtime: config, the in-process runner and the task manager. */
function buildRuntime(ctx: Context, config: Config, domain: CrawlerStore): CrawlerRuntime {
  const resolved = resolveConfig(config)
  return {
    config: resolved,
    manager: new CrawlerManager(createInProcessRunner({
      deps: (request) => realDeps(request, { browserDataRoot: config.browserDataRoot, channel: config.browserChannel }),
      domain: () => domain,
      mediaRoot: config.mediaRoot,
    }), { onFinished: crawlFinishedNotifier(ctx, resolved) }),
    domain,
  }
}

/**
 * 注册应用与页面（卸载逆序清理：应用与页面 → API 路由 → 运行中任务 → 存储域；
 * G13 规则 3：定义 → 工具 → 页面一条 effect 收线，任一步失败逆序回滚）。
 * Register the app and its pages (reverse-order dispose on unload; G13 rule 3:
 * definition → tools → pages in one effect, rolling back finished steps in
 * reverse on any failure).
 */
function registerAppAndPages(ctx: Context): void {
  ctx.effect(() => {
    const done: Array<() => void> = []
    try {
      done.push(ctx.apps.register(APP_DEFINITION, ctx))
      const pages = ctx.apps.pages(APP_ID, ctx)
      done.push(pages.register(OverviewPage, OverviewMeta))
    } catch (error: unknown) {
      for (const dispose of done.reverse()) dispose()
      throw error
    }
    return () => undefined
  }, 'veren-crawler:app')
}
 0