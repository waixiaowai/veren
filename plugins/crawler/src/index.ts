/**
 * @veren/crawler 插件入口：装配「多平台内容采集」插件。
 * The @veren/crawler plugin entry: assembles the multi-platform content
 * crawler.
 *
 * 已落地（按 design/ 文档分迭代推进）：配置解析、存储适配（脱敏/整形/
 * 文件介质）、任务状态机、启动参数校验、登录三段式、控制服务（任务
 * 管理器 + 日志缓冲 + 数据服务）与 HTTP 端点层。
 * Landed so far (iterating per the design/ documents): config resolution,
 * the storage adapter (masking/shaping/file media), the task state
 * machine, launch-argument validation, the three-segment login flow, and
 * the control service (task manager, log buffer, data service) with the
 * http endpoint layer.
 *
 * @module @veren/crawler
 */
import type { Context } from '@deepseek-ai/cordis'
import { Config, resolveConfig } from './config.ts'
import type { RuntimeConfig } from './config.ts'
import { CrawlerManager } from './control/manager.ts'
import { ControlServer } from './control/http-server.ts'
import { createChildRunner } from './runner/child-runner.ts'

export { Config } from './config.ts'

export const name = 'veren-crawler'

/** 依赖全部显式声明 / all dependencies declared explicitly */
export const inject = []
export const provide = []

/** 装配好的控制面 / the assembled control faces */
export interface CrawlerRuntime {
  /** 已解析配置 / the resolved configuration */
  readonly config: RuntimeConfig
  /** 任务管理器（进程内单例）/ the task manager (in-process singleton) */
  readonly manager: CrawlerManager
  /** HTTP 控制服务器 / the http control server */
  readonly server: ControlServer
  /** 实际监听端口（未启用时为 null）/ the actual listening port (null when disabled) */
  apiPort: number | null
}

/**
 * 装配本插件：解析配置 → 任务管理器 → 控制服务器（可选）→ 卸载逆序清理。
 * Assembles the plugin: resolve config → task manager → control server
 * (optional) → reverse-order dispose on unload.
 *
 * @param ctx - 宿主上下文 / the host context
 * @param config - 已校验的插件配置 / the validated plugin configuration
 */
export const apply = async (ctx: Context, config: Config): Promise<void> => {
  const resolved = resolveConfig(config)
  const manager = new CrawlerManager(createChildRunner())
  const server = new ControlServer({ manager, dataRoot: resolved.dataRoot })
  const runtime: CrawlerRuntime = { config: resolved, manager, server, apiPort: null }
  if (runtime.config.enableApi) {
    runtime.apiPort = await server.start(runtime.config.apiPort)
    ctx.logger.info('[veren-crawler] control api listening on 127.0.0.1:%s', runtime.apiPort)
  }
  // 卸载逆序清理：先停 HTTP 服务器，再等任务管理器排空（无泄漏）。
  // Reverse-order dispose on unload: stop the http server first, then drain
  // the task manager (no leaks).
  ctx.effect(() => async () => {
    await runtime.server.stop()
    if (runtime.manager.status().status === 'running' || runtime.manager.status().status === 'starting') {
      await runtime.manager.stop()
    }
    ctx.logger.info('[veren-crawler] runtime disposed')
  }, 'veren-crawler:runtime')
}
