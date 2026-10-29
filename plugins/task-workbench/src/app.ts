/**
 * 应用定义（§2.3）：task-workbench 的目录身份与能力声明。工具矩阵在 tools*.ts，
 * 动作体在 actions*.ts，页面在 page-*.tsx——本文件只承担"这个应用是谁"。
 * The application definition (§2.3): the task-workbench's catalog identity and
 * capability declarations. The tool matrix lives in tools*.ts, the action
 * bodies in actions*.ts, the pages in page-*.tsx — this file only carries
 * "who this app is".
 * @module @veren/task-workbench
 */
import type { AppCapability, AppId, ApplicationDefinition, PageKey } from '@veren/app-registry'

/** 应用 id（唯一权威；页面/URL/工具前缀都从这里推导）/ the app id (the single authority; pages/urls/tool prefix derive from it) */
export const APP_ID = 'task-workbench' as AppId

/** 应用定义：entry 是应用内页面键，不是 URL / entry is a page key, not a url */
export const APP_DEFINITION: ApplicationDefinition = {
  id: APP_ID,
  name: '任务工作台',
  description: '浏览、接取、完成任务，并把新任务发布/派发到宿主任务中心的其他应用',
  entry: 'list' as PageKey,
  instructions: '任务工作台负责任务的浏览与流转：列表页给出策略视图（可接取/已派发/被持有/已退回）与跨应用目录，'
    + '详情页处理单个任务，发布页把新工作单投递到任务中心（可选目标应用）。'
    + '所有操作通过本页挂载的 task_workbench__* 工具完成；写动作受同意门约束（browse/drive 两模式）。',
  // toolPrefix 缺省由 id 推导为 task_workbench；显式写出仅为可读性
  toolPrefix: 'task_workbench',
  requires: ['tasks:send' as AppCapability],
}
