/**
 * @veren/sub2api-admin 插件入口：注册「Sub2API 运营」应用（定义 → 工具 → 页面）。
 * Plugin entry: registers the Sub2API operations app (definition → tools → pages).
 *
 * 结构与 task-workbench 参考实现一致：
 * 1. ctx.apps.register(def, ctx) —— 定义应用并绑定本 fiber（卸载即整应用摘除）；
 * 2. ctx.apps.tools(id, ctx) —— 应用级工具目录（本地名，对外名由注册表拼前缀）；
 * 3. ctx.apps.pages(id, ctx) —— 注册页面（/apps/<appId>/...，单入口镜像进 page-registry）。
 * 页面与工具共用同一 Sub2AdminClient 与同一凭据配置（行 config 或 SUB2API_* env）。
 * @module @veren/sub2api-admin
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@veren/app-registry'
import { Sub2AdminClient } from './client.ts'
import type { AdminConfig } from './client.ts'
import { createSub2ApiPages } from './pages.tsx'
import { Sub2ApiStore } from './store.ts'
import { APP_DEFINITION, APP_ID, createAppTools } from './tools.ts'

export const name = 'veren-sub2api-admin'

export interface Config {
  /** Sub2API 实例地址 / the Sub2API instance base url */
  baseUrl?: string
  /** 管理员 API Key（x-api-key）/ the admin API key */
  adminApiKey?: string
  /** 管理员 JWT / the admin JWT */
  adminJwt?: string
  /** 管理员邮箱（自动登录）/ the admin email (auto login) */
  email?: string
  /** 管理员密码 / the admin password */
  password?: string
  /** 请求超时毫秒 / per-request timeout in ms */
  timeoutMs?: number
}

export const Config: z<Config> = z.object({
  baseUrl: z.string().description('Sub2API 实例地址，如 https://ai.veren.top'),
  adminApiKey: z.string().description('管理员 API Key（x-api-key），可选'),
  adminJwt: z.string().description('管理员 access_token（JWT），可选'),
  email: z.string().description('管理员邮箱（配合 password 自动登录），可选'),
  password: z.string().description('管理员密码，可选'),
  timeoutMs: z.number().description('请求超时毫秒数，默认 30000'),
})

/** app-registry 是声明式硬依赖：本插件就是一个应用 / a declared hard inject: this plugin IS an app */
export const inject = ['apps']
export const provide = []

export const apply = (ctx: Context, config: Config): void => {
  const apps = ctx.apps
  // 页面与工具共用同一客户端与凭据 / pages and tools share one client and one credential config
  const client = new Sub2AdminClient((config ?? {}) as AdminConfig)
  const store = new Sub2ApiStore()

  // 单一 effect 收线：定义 → 工具 → 页面，失败逆序回滚（task-workbench 同款）
  // One effect owns the wiring: definition → tools → pages; failures roll back in reverse.
  ctx.effect(() => {
    const done: Array<() => void> = []
    try {
      done.push(apps.register(APP_DEFINITION, ctx))
      const tools = apps.tools(APP_ID, ctx)
      for (const tool of createAppTools(client, store)) {
        done.push(tools.define(tool))
      }
      const pages = apps.pages(APP_ID, ctx)
      // 组件页（组件形态，RFC prompt-page-render §3.5）：组件 + 契约面成对注册
      // / component pages: components and contract faces registered as pairs
      const app9 = createSub2ApiPages(store)
      const pairs: Array<[unknown, unknown]> = [
        [app9.HomePage, app9.HomeMeta],
        [app9.ChannelsPage, app9.ChannelsMeta],
        [app9.GroupsPage, app9.GroupsMeta],
        [app9.UsersPage, app9.UsersMeta],
        [app9.SubscriptionsPage, app9.SubscriptionsMeta],
        [app9.FinancePage, app9.FinanceMeta],
        [app9.CodesPage, app9.CodesMeta],
        [app9.AccountsPage, app9.AccountsMeta],
        [app9.UsagePage, app9.UsageMeta],
      ]
      for (const [component, meta] of pairs) {
        done.push((pages.register as (c: unknown, m: unknown) => () => void)(component, meta))
      }
    } catch (error: unknown) {
      for (const dispose of done.reverse()) dispose()
      throw error
    }
    // 激活即拉一次真实数据（只读）；失败只记进 store.error，不影响挂载
    // Pull live data once on activation (read-only); failures land in store.error.
    void store.refreshAll(client)
    return () => undefined
  }, 'sub2api-admin:app')
}
