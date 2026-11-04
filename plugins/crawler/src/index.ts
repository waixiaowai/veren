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
import { Config, resolveConfig } from './config.ts'
import type { RuntimeConfig } from './config.ts'
import { CrawlerManager } from './control/manager.ts'
import { ControlApi } from './control/http-server.ts'
import { createChildRunner } from './runner/child-runner.ts'
import { createInProcessRunner } from './runner/inprocess-runner.ts'
import { realDeps } from './runner/real-deps.ts'
import { CRAWLER_DOMAIN_NAME, crawlerDomain, type CrawlerStore } from './store/domain.ts'
import { bindToolPort, createCrawlerTools } from './tools.ts'
import type { CrawlerRunRequest, RunnerSpawner } from './control/runner.ts'

export { Config } from './config.ts'

export const name = 'veren-crawler'

/** 宿主 web 服务器、存储域与工具表是显式依赖 / the host web server, storage domain and tool table are the explicit dependencies */
export const inject = ['webServer', 'storageDomain', 'tools']
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
function pickRunner(child: RunnerSpawner, domain: CrawlerStore, dataRoot: string): RunnerSpawner {
  return (request: CrawlerRunRequest, logs) => {
    if (request.saveOption === 'dsh') {
      return createInProcessRunner({ deps: realDeps(request), dataRoot, domain })(request, logs)
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
  runtime.manager.swapRunner(pickRunner(createChildRunner(), domain, runtime.config.dataRoot))
  // 工具面：`crawler__<本地名>` 全名注册，disposer 逆序即卸（意见 4）。
  // The tool face: registered under `crawler__<localName>` full names;
  // reverse-order dispose unregisters (directive 4).
  bindToolPort({ manager: runtime.manager, domain: () => runtime.domain, dataRoot: runtime.config.dataRoot })
  ctx.effect(() => createCrawlerTools().map((tool) => ctx.tools.register({ ...tool, name: `crawler__${tool.name}` })), 'veren-crawler:tools')
  // 卸载逆序清理：API 路由 → 运行中任务 → 存储域。
  // Reverse-order dispose: api routes → running task → storage domain.
  const api = new ControlApi({ manager: runtime.manager, dataRoot: runtime.config.dataRoot })
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
