/**
 * @veren/crawler 插件入口：装配「多平台内容采集」插件。
 * The @veren/crawler plugin entry: assembles the multi-platform content
 * crawler.
 *
 * 集成形态（按宿主惯例）：控制 API 挂在宿主 web 服务器上（不启动独立
 * 端口）；存储适配宿主 storageDomain（`dsh` 介质在宿主进程内跑）；文件
 * 介质经子进程 CLI；浏览器 CDP 接管优先。
 * Integration shape (per host conventions): the control api rides the host
 * web server (no standalone port); storage adapts the host storageDomain
 * (the `dsh` medium runs in-process); file media take the subprocess CLI;
 * the browser attaches over CDP first.
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
import { createChildRunner } from './runner/child-runner.ts'
import { createInProcessRunner } from './runner/inprocess-runner.ts'
import { realDeps } from './runner/real-deps.ts'
import { CRAWLER_DOMAIN_NAME, crawlerDomain, type CrawlerStore } from './store/domain.ts'
import { bindToolPort, createCrawlerTools } from './tools.ts'
import { bindOverviewRuntime, provideToolStubs, OverviewPage, OverviewMeta } from './page-overview.tsx'
import { APP_DEFINITION, APP_ID } from './app.ts'
import type { CrawlerRunRequest, RunnerSpawner } from './control/runner.ts'

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
 * 按介质选运行器：`dsh` 介质在宿主进程内跑（访问存储域），文件介质走子进程 CLI。
 * Picks the runner per medium: the `dsh` medium runs in-process (storage-domain
 * access), file media take the subprocess CLI.
 */
function pickRunner(child: RunnerSpawner, domain: CrawlerStore, config: RuntimeConfig): RunnerSpawner {
  return (request: CrawlerRunRequest, logs) => {
    if (request.saveOption === 'dsh') {
      const deps = realDeps(request, { browserDataRoot: config.browserDataRoot, channel: config.browserChannel })
      return createInProcessRunner({ deps, dataRoot: config.dataRoot, domain })(request, logs)
    }
    return child(request, logs)
  }
}

/**
 * 装配本插件：解析配置 → 打开存储域 → 任务管理器（按介质选运行器）→ 控制API挂宿主 → 卸载逆序清理。
 * Assembles the plugin: resolve config → open the storage domain → task
 * manager (runner picked per medium) → control api on the host webServer →
 * reverse-order dispose on unload.
 *
 * @param ctx - 宿主上下文 / the host context
 * @param config - 已校验的插件配置 / the validated plugin configuration
 */
export const apply = async (ctx: Context, config: Config): Promise<void> => {
  const runtime: CrawlerRuntime = { config: resolveConfig(config), manager: new CrawlerManager(createChildRunner()), domain: undefined }
  // 打开存储域；上一次激活留下的句柄先关掉（zhihu-ops 同款语义）。
  // Open the storage domain; a handle left by a previous activation closes
  // first (same semantics as zhihu-ops).
  const stale = ctx.storageDomain.get(CRAWLER_DOMAIN_NAME)
  if (stale !== undefined) {
    try {
      await stale.close()
    } catch (error: unknown) {
      ctx.logger.warn('[veren-crawler] previous storage domain could not close: %s', String(error))
    }
  }
  const domain = await ctx.storageDomain.open(crawlerDomain)
  runtime.domain = domain
  runtime.manager.swapRunner(pickRunner(createChildRunner(), domain, runtime.config))
  // 工具面：`crawler__<本地名>` 全名注册，disposer 逆序即卸（意见 4）。
  // The tool face: registered under `crawler__<localName>` full names;
  // reverse-order dispose unregisters (directive 4).
  const tools = createCrawlerTools().map((tool) => ({ ...tool, name: `crawler__${tool.name}` }))
  bindToolPort({ manager: runtime.manager, domain: () => runtime.domain, dataRoot: runtime.config.dataRoot })
  // 页面挂载用同一组全名工具（意见 5）：组件体在唯一一次渲染里登记。
  // The page mounts the same full-name tools (directive 5): the body
  // registers them in its one render.
  provideToolStubs(tools)
  bindOverviewRuntime({ manager: runtime.manager, domain: () => runtime.domain })
  ctx.effect(() => tools.map((tool) => ctx.tools.register(tool)), 'veren-crawler:tools')
  // 卸载逆序清理：应用与页面 → API 路由 → 运行中任务 → 存储域（G13 规则 3：
  // 定义 → 工具 → 页面一条 effect 收线，任一步失败逆序回滚）。
  // Reverse-order dispose: app+pages → api routes → running task → storage
  // domain (G13 rule 3: definition → tools → pages in one effect, rolling
  // back finished steps in reverse on any failure).
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
  const api = new ControlApi({ manager: runtime.manager, dataRoot: runtime.config.dataRoot, domain: () => runtime.domain })
  ctx.effect(() => api.register(ctx), 'veren-crawler:api')
  ctx.effect(() => async () => {
    if (runtime.manager.status().status === 'running' || runtime.manager.status().status === 'starting') {
      await runtime.manager.stop()
    }
    await domain.close()
    runtime.domain = undefined
    ctx.logger.info('[veren-crawler] runtime disposed')
  }, 'veren-crawler:runtime')
  ctx.logger.info('[veren-crawler] control api mounted on host web server, dataRoot=%s', runtime.config.dataRoot)
}
