/**
 * 页面会话的共享运行时：装配期绑定的论坛服务槽位、页面工具登记、
 * 页面作用域完成回报面（task_take/task_complete/task_fail）与页面自推
 * 消息的 followup 送达。两个页面文件（catalog/post）从这里取同一套机制。
 * The page sessions' shared runtime: the assembly-bound forum service slot,
 * page tool registration, the page-scoped completion face
 * (task_take/task_complete/task_fail), and the followup delivery of the
 * page's own messages. Both page files (catalog/post) take this one machinery.
 *
 * @module @veren/forum-app/page-runtime
 */
import { buildPageTaskTools } from '@veren/task-center'
import type {} from '@veren/task-center'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { PageFC } from '@veren/prompt-page'
import type { ForumToolsPort } from '@veren/forum'

/** 应用内 URL 前缀 / the app-scoped url prefix */
export const URL_PREFIX = '/apps/forum'

/** 应用 id（页面作用域 task 面按它查 live 行）/ the app id (the page-task face looks up live rows by it) */
const FORUM_APP_ID = 'forum'

/** 工具对外名：`forum__<本地名>`（§3.4.3）——组件体直接以全名登记
 * / the external tool name — the body registers under the full name directly */
const externalName = (localName: string): string => `forum__${localName}`

/** 装配期绑定面（ctx + port 的最小形状）/ the assembly-bound face (the minimal ctx + port shape) */
export interface BoundServices {
  readonly ctx: Context
  readonly port: () => ForumToolsPort
}

/**
 * 装配期绑定的模块级槽位：组件体的工具构建与首屏读从这里取 forum 服务面。
 * 注册（`registerForumApp`）一定发生在任何页面打开之前，槽位此刻必然已绑定；
 * 未绑定即取 = 装配错误，fail loud。
 * The module-level slot bound at assembly time: the bodies' tool builds and
 * first-screen reads take the forum face from here. Registration
 * (registerForumApp) always precedes any page open, so the slot is bound by
 * then; reading it unbound is an assembly error and fails loud.
 */
let services: BoundServices | undefined

/** 装配时绑定论坛服务面（app.ts 的单入口注册调用一次）/ bind at assembly time (called once by app.ts's registration) */
export function bindForumServices(ctx: Context, port: () => ForumToolsPort): void {
  services = { ctx, port }
}

/** 取绑定的服务面；未绑定 = 装配错误 fail loud / read the bound face; unbound = assembly error, fail loud */
export function requireServices(): BoundServices {
  if (services === undefined) {
    throw new Error('[forum-app] forum services are not bound; registerForumApp must run before pages open')
  }
  return services
}

/**
 * 一条页面工具绑定：本地名 + 产出该定义的构建器。构建器闭包 ctx（callerOf 从
 * ctx.agentPresets 解析调用者）与 port；组件体按绑定登记全名定义——页面的工具
 * 面只有这一份声明，永不漂移。
 * One page-tool binding: the local name plus the builder producing its
 * definition. The builder closes over ctx (callerOf resolves the caller from
 * ctx.agentPresets) and the port; the body registers the full-named definition
 * from the binding — the page's tool face has this one declaration and can
 * never drift.
 */
export interface PageToolBinding {
  readonly name: string
  readonly build: (ctx: Context, port: () => ForumToolsPort) => ToolDefinition
}

/** 按绑定登记工具（全名）/ register the bound tools under full names */
export function registerTools(agent: Parameters<PageFC>[1], bindings: readonly PageToolBinding[]): void {
  const { ctx, port } = requireServices()
  for (const binding of bindings) {
    agent.ctx.tools.register({ ...binding.build(ctx, port), name: externalName(binding.name) })
  }
}

/**
 * 页面作用域完成回报面（docs/unattended-page-contract.cn.md §6 的一般形态）：
 * 投递到本页的任务由此回报——task_take / task_complete / task_fail（无 id 参数，
 * 目标 URL 就是本页；名字与宿主全局面逐字相同，TASK 块与收件箱指引逐字为真）。
 * 作用域解析走装配绑定的 ctx（page-registry 实例索引反查本会话的 live 行）。
 * The page-scoped completion face (the general shape of
 * docs/unattended-page-contract.md §6): tasks delivered to this page report
 * here — task_take / task_complete / task_fail (no id parameter; the target url
 * IS this page; names match the host global face verbatim so the TASK block and
 * inbox guidance read true). Scope resolution rides the bound ctx (the
 * page-registry instance index resolves this session's live row).
 */
export function registerPageTaskFace(agent: Parameters<PageFC>[1]): void {
  const { ctx } = requireServices()
  for (const tool of buildPageTaskTools(() => ctx.taskCenter, {
    urlOfSession: async (sessionId) => {
      const rows = await ctx.pageRegistry.instances.listByApp(FORUM_APP_ID)
      return rows.find((row) => row.state === 'live' && row.sessionId === sessionId)?.url
    },
  })) {
    agent.ctx.tools.register(tool)
  }
}

/** 页面自推消息的 source kind（宿主装配的 PAGE 块同源；wire 值协议常量）
 * / the source kind of a page-pushed message (same source as the host assembly's PAGE block; a wire-value protocol constant) */
const PAGE_SOURCE = 'app/page' as const

// 类型合并扩充：复用宿主的 app/page 消息源。形状必须与 app-host 的声明逐字
// 一致——TS 接口合并规则下两处同键成员类型不同会直接报错，漂移无处藏身。
// Type-merge extension: reuse the host's app/page message source. The shape
// must match app-host's declaration verbatim — under TS interface merging,
// same-key members with different types are a hard error, so the two cannot
// drift apart.
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** A page session's PAGE block (app-host) and the page body's own followups. @persistenceSource user */
    'app/page': { kind: 'app/page' }
  }
}

/** 把一条首屏文本作为新消息推进上下文（页面自己的送达路径）/ push one first-screen text into the context as a new message (the page's own delivery path) */
export function followupText(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: PAGE_SOURCE } }))
}
