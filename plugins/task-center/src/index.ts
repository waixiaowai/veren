/**
 * @veren/task-center 公共出口：默认导出 TaskCenterService（Service 插件）。
 * Public entry: default-exports TaskCenterService (a Service-class plugin).
 *
 * 挂载后消费方经 `inject: ['taskCenter']` 拿到同一实例（部署级共享）。
 * @module @veren/task-center
 */
import type { Context } from '@deepseek-ai/cordis'
import { TaskCenterService } from './service.ts'

export { TASK_CENTER_NAME, TaskCenterService } from './service.ts'
export {
  Config, MAX_BODY_CHARS, MAX_TITLE_CHARS, noticeText, TaskError,
} from './service.ts'
export type { AppResolver, AppSnapshot, TaskCenterConfig } from './service.ts'
export { TASK_CENTER_DOMAIN_NAME, taskCenterDomain } from './storage.ts'
export type { DeliveryRecord, InboxNotice, TaskCenterStore } from './storage.ts'
export * from './types.ts'
export type { TaskCenterService as TaskCenterServiceType } from './service.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** 任务中心：应用发任务，Agent/收件箱接取与回报。 */
    taskCenter: TaskCenterService
  }
}

/** Loader 入口：服务类即插件（Service Definition）。 */
export default TaskCenterService
