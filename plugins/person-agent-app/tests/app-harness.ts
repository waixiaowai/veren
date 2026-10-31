/**
 * 组合测试帮手：真实 cordis Context + 真实 AppRegistryService/PageRegistryService，
 * 外部数据面服务全部为假实现（它们是硬 inject，必须真提供）。另附假 agent 与
 * 页面挂载器——组件体在假 agent 上执行恰好一次，登记/首屏/skill 都可断言。
 * Composition-test helpers: a real cordis Context with the real
 * AppRegistryService/PageRegistryService, and fake implementations for every
 * data-face service (they are hard injects and must really be provided). Also a
 * fake agent and a page mounter - the body runs exactly once on the fake agent,
 * with registrations / the first screen / skills all assertable.
 */
import { Context } from '@deepseek-ai/cordis'
import type { Fiber } from '@deepseek-ai/cordis'
import AppRegistryPlugin, { AppRegistryService } from '@veren/app-registry'
import PageRegistryPlugin, { PageRegistryService } from '@veren/page-registry'
import { apply, inject, name } from '../src/index.ts'
import { defineComponentPage } from '@veren/prompt-page'
import type { ComponentPageMeta, PageParams } from '@veren/prompt-page'

/** 假任务中心：open 列表可编程 / a fake task center with a programmable open list */
function fakeTaskCenter(options: { openTitles?: string[]; failList?: boolean } = {}) {
  return {
    list: async () => {
      if (options.failList === true) throw new Error('storage backend down')
      return (options.openTitles ?? []).map((title, index) => ({ id: `t-${index + 1}`, title, status: 'open' }))
    },
  }
}

/** 假工作区注册表 / a fake workspace registry */
function fakeWorkspaceRegistry(rows: Array<{ id: string; title: string; sessionIds: string[] }> = [
  { id: 'ws-1', title: '主工作区', sessionIds: ['s-1', 's-2'] },
  { id: 'ws-2', title: '副工作区', sessionIds: [] },
]) {
  return {
    archivedSessionIds: ['s-archived'],
    list: () => rows,
    // 工具按 id 解析工作区（workspace_session_list 的执行面）/ tools resolve workspaces by id
    get: (id: string) => rows.find((row) => row.id === id),
  }
}

/**
 * 挂好真实注册表与应用插件（三个数据面服务总是真实提供：它们是硬 inject）。
 * Mount real registries plus the app plugin (the three data faces are always
 * provided for real: they are hard injects).
 */
export async function install(options: {
  openTitles?: string[]
  failList?: boolean
  failPresetList?: boolean
  failModelList?: boolean
  workspaces?: Array<{ id: string; title: string; sessionIds: string[] }>
} = {}): Promise<{
  ctx: Context
  apps: AppRegistryService
  pageRegistry: PageRegistryService
  fiber: Fiber
}> {
  const ctx = new Context()
  // 两个注册表服务挂在同一个宿主上下文上，镜像面由测试显式接上（app-host 语义）。
  // Both registries live on one host context; the mirror is wired explicitly.
  const hostCtx = new Context()
  const apps = new AppRegistryService(hostCtx)
  const pageRegistry = new PageRegistryService(hostCtx)
  ctx.provide('apps', apps)
  ctx.provide('pageRegistry', pageRegistry)
  apps.setPageMirror({
    // live 必须透传（与真实宿主 wire.ts 同缝）：live 改必填后，丢绑定会在登记处抛错。
    // `live` must pass through (the same seam as the real host's wire.ts): with live
    // required, dropping the binding now throws at registration.
    registerAppPage: (appId: never, page: never, live: never) => pageRegistry.registerAppPage(appId, page, live),
    releaseApp: (appId: never) => pageRegistry.releaseApp(appId),
  })
  ctx.provide('workspaceRegistry', fakeWorkspaceRegistry(options.workspaces) as never)
  ctx.provide('taskCenter', fakeTaskCenter(options) as never)
  // 页面正文的另外两块部署事实：预设名单与模型目录。默认给真实形状的数据，
  // 失败测试用开关让读取抛错，钉住"失败如实渲染、不编造"。
  // The other two deployment facts in the page body: preset roster and model
  // catalog. The defaults carry realistic shapes; failure tests flip a switch so
  // the read throws, pinning "failures render honestly, never faked".
  ctx.provide('agentPresets', {
    list: async () => {
      if (options.failPresetList === true) throw new Error('preset registry down')
      return [
        { id: 'standard' },
        { id: 'person-agent', name: 'Person Agent', description: 'Bridge', order: 5 },
        { id: 'broken-one', name: 'Broken preset', broken: 'activation failed' },
      ]
    },
  } as never)
  ctx.provide('llm', {
    listProviders: () => {
      if (options.failModelList === true) throw new Error('llm registry down')
      return [{ id: 'deepseek', name: 'DeepSeek' }]
    },
    listModels: async () => [{
      provider: 'deepseek',
      id: 'deepseek-flash',
      name: 'DeepSeek Flash',
      inputModalities: ['text'],
    }],
    resolveModelInfo: async () => ({ context: { contextWindow: 128000 } }),
  } as never)
  // 会话事实面：目录工具执行时直接读 ctx.sessions / ctx.sessionProjections，
  // 建会话工具读 ctx.sessionController——三者都必须真提供（插件的 inject 声明）。
  // The session-fact faces: the catalog tool reads ctx.sessions /
  // ctx.sessionProjections at execution time and the create tool reads
  // ctx.sessionController — all three must really be provided (the plugin's inject).
  ctx.provide('sessions', {
    get: (id: string) => (id === 's-1'
      ? { header: { id, createdAt: 1_700_000_000_000, agentPreset: 'default' } }
      : undefined),
  } as never)
  ctx.provide('sessionProjections', {
    stateOf: () => ({ lastUsed: { provider: 'deepseek', model: 'deepseek-chat' } }),
  } as never)
  ctx.provide('sessionController', {
    create: async () => ({ id: 's-created' }),
    rename: async ({ title }: { title: string }) => ({ title, seq: 1 }),
  } as never)
  const fiber = ctx.plugin({ name, inject, apply })
  await fiber
  return { ctx, apps, pageRegistry, fiber }
}

// 卸载登记簿：每个 spec 文件在 afterEach 里逆序清线（G13：注册逆序清理）。
// The disposer ledger: every spec file unwinds it in reverse in afterEach
// (G13: registrations clean up in reverse order).
const disposers: (() => Promise<void>)[] = []

/** 登记一个卸载动作（测试体内调用）/ register one disposer (call inside a test body) */
export function trackDisposer(dispose: () => Promise<void>): void {
  disposers.push(dispose)
}

/** afterEach 用的逆序清线 / the reverse-order unwind for afterEach */
export async function disposeTracked(): Promise<void> {
  for (const dispose of disposers.reverse()) await dispose()
  disposers.length = 0
}

/**
 * 假会话 agent：记录组件体直登的定义（页面的工具面断言源）。
 * A fake session agent: records the body's direct registrations (the assertion
 * source of a page's tool face).
 */
function fakeAgent() {
  const registered: Array<{ name: string; definition: unknown }> = []
  const followups: string[] = []
  const skills: Array<{ name: string; description: string; content: string }> = []
  const agent = {
    ctx: {
      tools: {
        register: (definition: { name: string }) => {
          registered.push({ name: definition.name, definition })
          return () => undefined
        },
      },
      // 组件体的首屏读经 effect 发起：这里立即执行，promise 异步落定
      // / the body's first-screen read starts via an effect: run it now, the promise settles async
      effect: (run: () => unknown) => { void Promise.resolve().then(run); return async () => undefined },
      on: () => () => undefined,
      // 单会话 skill 组件体直登的断言面 / the assertion face of body-registered single-session skills
      skills: {
        register: (skill: { name: string; description: string; content: string }) => {
          skills.push(skill)
          return () => undefined
        },
      },
    },
    session: { id: 'spec' },
    followup: (message: { content: ReadonlyArray<{ type: string; text?: string }> }) => {
      followups.push(...message.content.map((block) => block.text ?? ''))
    },
  }
  return { agent: agent as never, registered, followups, skills }
}

/**
 * 挂载真实页面组件（一次性渲染）：组件体在假 agent 上执行恰好一次——登记名剥去
 * `person_agent__` 前缀返回；异步首屏由组件体自己的 effect 读出、经 followup
 * 送达（本帮手不等它，测试按需 vi.waitFor）。
 * Mount a real page component (one-shot): the body runs exactly once on the
 * fake agent — registered names come back with the `person_agent__` prefix
 * stripped; the async first screen is read by the body's own effect and
 * delivered via followup (this helper does not wait for it; tests vi.waitFor
 * as needed).
 */
export async function mountPage(component: (props: never, agent: never) => unknown, meta: ComponentPageMeta<never>, ctx: Context, params: PageParams = {}): Promise<{
  body: string
  followups: () => string[]
  skills: () => Array<{ name: string; description: string; content: string }>
  recorded: () => string[]
  definitions: () => { name: string; execute: (args: unknown, exec: unknown) => Promise<unknown> }[]
}> {
  const fake = fakeAgent()
  const body = defineComponentPage(component as never, meta).live.mount(params, fake.agent)
  return {
    body,
    followups: () => fake.followups,
    skills: () => fake.skills,
    recorded: () => fake.registered.map((entry) => entry.name.replace('person_agent__', '')),
    definitions: () => fake.registered.map((entry) => entry.definition as { name: string; execute: (args: unknown, exec: unknown) => Promise<unknown> }),
  }
}
