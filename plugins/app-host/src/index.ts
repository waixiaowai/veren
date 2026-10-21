/**
 * @veren/app-host 插件入口：宿主装配层（第 1 阶段松对接的收敛解）。
 * Plugin entry: the host assembly layer for the Veren application framework.
 *
 * Loader 行顺序：app-registry → page-registry → task-center → **app-host**；
 * `inject` 已声明同样依赖，Loader 按 fiber 激活顺序保证三者先于本插件就绪。
 * 装配内容见 {@link wireAppHost}；装一个新应用插件不需要任何额外接线。
 * @module @veren/app-host
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { AppHostGatewayService } from './gateway.ts'
import { wireAppHost } from './wire.ts'

export { wireAppHost, requireFaces } from './wire.ts'
export { createRealSessionPort, loggingFocus, eventFocus, PAGE_MESSAGE_SOURCE, TASK_MESSAGE_SOURCE, NOTICE_MESSAGE_SOURCE } from './session-port.ts'
export type { FocusPort, FocusEventPayload } from './session-port.ts'
export { AppHostGatewayService, APP_HOST_GATEWAY_NAME } from './gateway.ts'
export type { AppGatewayApp } from './gateway.ts'

export const name = 'veren-app-host'

export interface Config {
  /** 预留：装配级可调项（如 focus 行为开关） / reserved assembly tunables */
  enabled: boolean
}

export type AppConfig = { enabled: boolean }
export const Config: z<AppConfig> = z.object({
  enabled: z.boolean().default(true).description('是否执行装配 / whether to run the assembly'),
})

/** 三个服务 + 真实宿主会话面 + 工具注册表 + 默认模型就绪后才装配 / assemble after the three services, the host session face, the tool registry, and the default-model service */
export const inject = ['apps', 'pageRegistry', 'taskCenter', 'sessions', 'agents', 'tools', 'agentDefaultModel']
export const provide = []

export const apply = (ctx: Context, config: AppConfig): void => {
  if (!config.enabled) {
    ctx.logger.warn('app-host: assembly disabled by config; the three services run unwired')
    return
  }
  // GUI 网关（ctx.appHost）：应用目录/入口页的 Remote 面，随装配同生共死
  // / the GUI gateway (ctx.appHost): the Remote face for the catalog and entry
  // pages, living and dying with the assembly
  ctx.plugin(AppHostGatewayService)
  ctx.effect(() => wireAppHost(ctx), 'app-host:wire')
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** GUI 网关：应用目录与入口页打开的 Remote 面（客户端 app-host-ui 消费）。 */
    appHost: AppHostGatewayService
  }
}
