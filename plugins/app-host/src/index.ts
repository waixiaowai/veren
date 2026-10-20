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
import { wireAppHost } from './wire.ts'

export { wireAppHost, requireFaces } from './wire.ts'
export { createRealSessionPort, loggingFocus, PAGE_MESSAGE_SOURCE, TASK_MESSAGE_SOURCE, NOTICE_MESSAGE_SOURCE } from './session-port.ts'
export type { FocusPort } from './session-port.ts'

export const name = 'veren-app-host'

export interface Config {
  /** 预留：装配级可调项（如 focus 行为开关） / reserved assembly tunables */
  enabled: boolean
}

export type AppConfig = { enabled: boolean }
export const Config: z<AppConfig> = z.object({
  enabled: z.boolean().default(true).description('是否执行装配 / whether to run the assembly'),
})

/** 三个服务 + 真实宿主会话面 + 工具注册表就绪后才装配 / assemble after the three services, the host session face, and the tool registry */
export const inject = ['apps', 'pageRegistry', 'taskCenter', 'sessions', 'agents', 'tools']
export const provide = []

export const apply = (ctx: Context, config: AppConfig): void => {
  if (!config.enabled) {
    ctx.logger.warn('app-host: assembly disabled by config; the three services run unwired')
    return
  }
  ctx.effect(() => wireAppHost(ctx), 'app-host:wire')
}
