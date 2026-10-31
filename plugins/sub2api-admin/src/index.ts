/**
 * @veren/sub2api-admin 插件入口：注册「Sub2API 运营」应用（定义 → 工具 → 页面）。
 * Plugin entry: registers the Sub2API operations app (definition → tools → pages).
 *
 * 结构与 task-workbench 参考实现一致：
 * 1. ctx.apps.register(def, ctx) —— 定义应用并绑定本 fiber（卸载即整应用摘除）；
 * 2. createAppTools —— defineTool 产物以全名（`sub2api_admin__<本地名>`）备好，
 *    经 bindSub2ApiRuntime 绑进页面模块槽位：组件体在唯一一次渲染里直接
 *    agent.ctx.tools.register 登记本页工具——没有应用目录的 define 间接层；
 * 3. ctx.apps.pages(id, ctx) —— 注册页面（/apps/<appId>/...，单入口镜像进
 *    page-registry）。页面与工具共用同一 Sub2AdminClient 与同一凭据配置。
 * Same shape as the task-workbench reference:
 * 1. ctx.apps.register(def, ctx) — the app rides this fiber (teardown removes it whole);
 * 2. createAppTools — defineTool products prepared under full names
 *    (`sub2api_admin__<local>`), bound into the pages' module slot via
 *    bindSub2ApiRuntime: the bodies register their tools via
 *    agent.ctx.tools.register in the one render — no catalog define indirection;
 * 3. ctx.apps.pages(id, ctx) — the pages (single entry, mirrored into
 *    page-registry internally). Pages and tools share one client and one
 *    credential config.
 * @module @veren/sub2api-admin
 */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@veren/app-registry'
import { Sub2AdminClient } from './client.ts'
import type { AdminConfig } from './client.ts'
import {
  AccountsMeta, AccountsPage,
  bindSub2ApiRuntime,
  ChannelsMeta, ChannelsPage,
  CodesMeta, CodesPage,
  externalName, FinanceMeta, FinancePage,
  GroupsMeta, GroupsPage,
  HomeMeta, HomePage,
  SubscriptionsMeta, SubscriptionsPage,
  UsageMeta, UsagePage,
  UsersMeta, UsersPage,
} from './pages.tsx'
import { Sub2ApiStore } from './store.ts'
import { APP_DEFINITION, APP_ID } from './app-definition.ts'
import { createAppTools } from './tools.ts'

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

/**
 * 单一 effect 的接线体：定义 → 工具 → 页面，体内任何一步失败都把已完成的步骤
 * 逆序回滚——绝不留下"应用在、工具缺页"的半接线状态（task-workbench 同款）。
 * 激活即拉一次真实数据（只读）；失败只记进 store.error，不影响挂载。
 * The wiring body inside the one effect: definition → tools → pages; any
 * failing step rolls the finished ones back in reverse (the task-workbench
 * shape). Live data is pulled once on activation (read-only); failures land in
 * store.error without affecting the mount.
 */
function wireSub2ApiApp(ctx: Context, client: Sub2AdminClient, store: Sub2ApiStore): () => void {
  const done: Array<() => void> = []
  try {
    // 1) 应用定义：绑定本 fiber，fiber 销毁 → 整应用（页面+工具）摘除
    // / 1) the app definition: fiber-bound; fiber teardown removes pages+tools
    done.push(ctx.apps.register(APP_DEFINITION, ctx))
    // 2) 工具以全名备好（`sub2api_admin__<本地名>`，§3.4.3）绑进页面模块槽位：组件体在唯一一次渲染里直接 agent.ctx.tools.register 登记。
    // / 2) tools prepared under full names, bound into the pages' module slot:
    //    the bodies register via agent.ctx.tools.register in the one render.
    const tools = createAppTools(client, store).map((tool) => ({ ...tool, name: externalName(tool.name) }))
    bindSub2ApiRuntime(store, tools)
    // 3) 页面注册走单入口，app-registry 内部镜像进 page-registry（可被 openUrl 解析）；镜像失败会回滚并抛错。
    // / 3) registration rides the single entry, mirrored into page-registry
    //    (openUrl-resolvable); a mirror failure rolls back and throws.
    const pages = ctx.apps.pages(APP_ID, ctx)
    done.push(pages.register(HomePage, HomeMeta))
    done.push(pages.register(ChannelsPage, ChannelsMeta))
    done.push(pages.register(GroupsPage, GroupsMeta))
    done.push(pages.register(UsersPage, UsersMeta))
    done.push(pages.register(SubscriptionsPage, SubscriptionsMeta))
    done.push(pages.register(FinancePage, FinanceMeta))
    done.push(pages.register(CodesPage, CodesMeta))
    done.push(pages.register(AccountsPage, AccountsMeta))
    done.push(pages.register(UsagePage, UsageMeta))
  } catch (error: unknown) {
    for (const dispose of done.reverse()) dispose()
    throw error
  }
  void store.refreshAll(client)
  return () => undefined
}

export const apply = (ctx: Context, config: Config): void => {
  // 页面与工具共用同一客户端与凭据 / pages and tools share one client and one credential config
  const client = new Sub2AdminClient((config ?? {}) as AdminConfig)
  const store = new Sub2ApiStore()
  // 单一 effect 收线：定义 → 工具 → 页面（回滚语义见 wireSub2ApiApp 的注释）。
  // One effect owns the wiring: definition → tools → pages (rollback semantics
  // documented on wireSub2ApiApp).
  ctx.effect(() => wireSub2ApiApp(ctx, client, store), 'sub2api-admin:app')
}
