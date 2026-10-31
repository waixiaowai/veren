/**
 * 装配是一处：wireAppHost 显式接上全部接缝（resolver / 镜像面 / 会话端口 /
 * 网关 / 完备性告警）的组合验收。
 * The assembly is one place: composition acceptance for wireAppHost wiring
 * every seam (resolver / mirror / session port / gateway / coverage warning).
 * @module tests/assembly-wiring.spec
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import * as Storage from '@deepseek-ai/dsh-storage'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { createElement } from '@veren/prompt-core'
import AppRegistryPlugin from '@veren/app-registry'
import type { AppId, PageKey } from '@veren/app-registry'
import PageRegistryPlugin from '@veren/page-registry'
import TaskCenterPlugin from '@veren/task-center'
import type { PageInstanceKey } from '@veren/prompt-page'
import { apply, Config, inject, name, wireAppHost } from '../src/index.ts'
import { boot, registerMiniApp, tempRoot } from './app-host.harness.ts'

describe('装配是一处：wireAppHost 显式接上全部接缝', () => {
  it('resolver / 镜像面 / 会话端口由装配接好：发任务校验发送方、页面可被 openUrl 解析', async () => {
    const h = await boot()
    registerMiniApp(h)
    // 镜像面：apps.pages 单入口注册 → openUrl 直接可解析（装配接的线在起作用）
    const opened = await h.pages.openUrl('/apps/mini/task/1' as PageInstanceKey)
    expect(opened.sessionId).toBeTypeOf('string')
    // 页面会话加入部署默认工作区：会话头 cwd 决定工作区归属（真机缺陷：曾落进
    // 「未分组」——进程 cwd 不属于任何工作区）。
    // / the page session joins the deployment default workspace: the header cwd
    // decides membership (live defect: it used to land in "ungrouped" because
    // the process cwd belongs to no workspace).
    expect(h.host.agentCreations.at(-1)).toEqual({
      sessionId: opened.sessionId,
      cwd: h.host.defaultWorkspacePath,
    })
    // 候选表登记同样必需：sessionIds 是候选列表的过滤视图，不 attach 就只剩 cwd
    // / the candidate account is required too: sessionIds filters the candidate list
    expect(h.host.attached.at(-1)).toEqual({ workspaceId: 'ws-default', sessionId: opened.sessionId })
    // resolver：未注册应用 send 被拒（装配接的线在起作用）
    await expect(h.tasks.send({
      kind: 'mini/kind' as never, title: 't',
      target: { url: '/apps/mini/task/1' as PageInstanceKey, appId: 'ghost', page: 'task', params: {} },
    })).rejects.toMatchObject({ code: 'task/send-forbidden' })
  })

  it('单会话 skill 随组件体直登进 agent 作用域：本页可见，重开（废弃=退役 agent）时随 fiber 释放', async () => {
    const h = await boot()
    registerMiniApp(h)
    // 详情页组件体直登 mini-skill：挂载即进该会话的作用域（宿主不经手挂载）
    // / the detail page's body registers mini-skill: it lands in the scope at
    // mount (the host never mounts one)
    const opened = await h.pages.openUrl('/apps/mini/task/1' as PageInstanceKey)
    const firstScope = h.host.scopes.get(opened.sessionId)
    if (firstScope === undefined) throw new Error('expected the first page session scope')
    expect(firstScope.skills.has('mini-skill')).toBe(true)
    expect(firstScope.registry.has('mini__read')).toBe(true)
    // 重开同 URL：旧会话废弃 → retire 整体拆除 agent，作用域登记全部消失
    // / reopen the same url: the old session is deprecated → retire tears the
    // agent down whole, every scope registration goes away
    const reopened = await h.pages.openUrl('/apps/mini/task/1' as PageInstanceKey)
    expect(firstScope.skills.has('mini-skill')).toBe(false)
    expect(firstScope.registry.has('mini__read')).toBe(false)
    const secondScope = h.host.scopes.get(reopened.sessionId)
    if (secondScope === undefined) throw new Error('expected the second page session scope')
    expect(secondScope.skills.has('mini-skill')).toBe(true)
  })

  it('网关 sessionApp：页面会话解析到所属应用（工具栏"已选应用"的事实源），普通会话 null', async () => {
    const h = await boot()
    registerMiniApp(h)
    const opened = await h.pages.openUrl('/apps/mini/list' as PageInstanceKey)
    const owner = await h.ctx.appHost.sessionApp(opened.sessionId)
    expect(owner?.id).toBe('mini')
    expect(owner?.name).toBe('mini')
    // 普通会话（不在页面实例索引里）→ null，工具栏保持下拉
    // / an ordinary session (absent from the page instance index) → null; the toolbar keeps the dropdown
    expect(await h.ctx.appHost.sessionApp('session-ordinary')).toBeNull()
    // 被重开取代的旧会话是废弃行，不再属于该应用（查询只认 live 行）
    // / a session superseded by a reopen is a deprecated row and no longer owns
    // the app (the query counts live rows only)
    const reopened = await h.pages.openUrl('/apps/mini/list' as PageInstanceKey)
    expect(await h.ctx.appHost.sessionApp(opened.sessionId)).toBeNull()
    expect((await h.ctx.appHost.sessionApp(reopened.sessionId))?.id).toBe('mini')
  })

  it('选择应用 = 立即打开页面会话（一次性渲染语义）：新建会话、agent 当场激活、工具挂好、屏蔽生效', async () => {
    const h = await boot()
    registerMiniApp(h)
    const focusEvents: Array<{ sessionId: string }> = []
    h.ctx.on('app-host/focus', (payload) => { focusEvents.push(payload) })
    // 选择动作：传入的 sessionId 只做 Remote 面兼容，新页面会话总是新建
    // / the pick: the passed sessionId is Remote-surface compatibility only; a
    // fresh page session is always created
    const picked = await h.ctx.appHost.stage('mini', 'session-composer' as SessionId)
    expect(picked.sessionId).not.toBe('session-composer')
    // 页面实例即刻 live（页面实例与 agent 共存亡，渲染发生在 agent/created）
    // / the instance is live right away (the instance lives and dies with the
    // agent; the render happens at agent/created)
    const rows = await h.pages.instances.listByApp('mini')
    expect(rows.some((row) => row.sessionId === picked.sessionId && row.state === 'live')).toBe(true)
    // 新会话的 agent 作用域：工具已登记（组件体的唯一一次渲染已执行）、引导工具已屏蔽
    // / the new session's agent scope: tools registered (the body's one render ran), bootstrap tools denied
    const scope = h.host.scopes.get(picked.sessionId)
    if (scope === undefined) throw new Error('expected the picked page session scope')
    expect([...scope.registry.keys()]).toEqual(['mini__read'])
    expect(scope.denials).toEqual(['app_open', 'app_list', 'app_pages'])
    // PAGE 块经 followup 进入会话；GUI 收到切界面事件
    // / the PAGE block enters the session via followup; the GUI got the focus event
    expect(scope.followups.some((m) => m.startsWith('PAGE mini/list'))).toBe(true)
    expect(focusEvents).toEqual([{ sessionId: picked.sessionId }])
    // 新建路径的身份也在场：agent/created 触发于两阶段创建的 reserve 与 commit
    // 之间，此刻行还是 reserved——live-only 匹配会让新会话永远拿不到身份
    // / the fresh-create path carries the identity too: agent/created fires
    // between the two-phase reserve and commit, so the row is still reserved
    // there — a live-only match leaves fresh sessions permanently unbadged
    expect(h.host.promptContexts.some((p) => p.name === 'APP_HOST_PAGE_IDENTITY')).toBe(true)
    // 工具栏显示已选应用 / the toolbar shows the selected app
    expect(await h.ctx.appHost.sessionApp(picked.sessionId)).toMatchObject({ id: 'mini' })
  })

  it('重启后再激活：agent/created 经 realm 过滤载体派发，重挂 + PAGE 重发 + 身份仍然到位（真机 2.0.8 反例的收编）', async () => {
    const h = await boot()
    registerMiniApp(h)
    const picked = await h.ctx.appHost.stage('mini', 'session-composer' as SessionId)
    const first = h.host.scopes.get(picked.sessionId)
    if (first === undefined) throw new Error('expected the picked page session scope')
    expect([...first.registry.keys()]).toEqual(['mini__read'])
    // 重启语义：旧 agent 连同作用域消亡（fiber 死亡），live 行原样留在索引里
    // / restart semantics: the old agent dies with its scope (fiber death);
    // the live row stays in the index untouched
    h.host.stopAgent(picked.sessionId)
    expect(first.registry.size).toBe(0)
    expect((await h.pages.instances.listByApp('mini')).some((row) => row.sessionId === picked.sessionId && row.state === 'live')).toBe(true)
    // 真实宿主的 resume 派发：scopeTarget 载体 + 跨域 baseFilter——没有
    // { global: true } 时这次派发一个监听器都到不了（这正是真机停摆的形状）。
    // / the real host's resume dispatch: a scopeTarget carrier with a
    // cross-realm baseFilter — without { global: true } this dispatch reaches
    // zero listeners (exactly the live stall shape).
    await h.host.resumeAgentFiltered(picked.sessionId)
    const scope = h.host.scopes.get(picked.sessionId)
    if (scope === undefined) throw new Error('expected the resumed agent scope')
    expect([...scope.registry.keys()]).toEqual(['mini__read'])
    expect(scope.followups.some((m) => m.startsWith('PAGE mini/list'))).toBe(true)
    expect(h.host.promptContexts.some((p) => p.name === 'APP_HOST_PAGE_IDENTITY')).toBe(true)
  })

  it('unstage = 关闭该会话的页面实例：agent 退役（登记随 fiber 拆除）、索引行翻废弃', async () => {
    const h = await boot()
    registerMiniApp(h)
    const picked = await h.ctx.appHost.stage('mini', 'session-composer' as SessionId)
    const scope = h.host.scopes.get(picked.sessionId)
    if (scope === undefined) throw new Error('expected the picked page session scope')
    expect([...scope.registry.keys()]).toEqual(['mini__read'])
    await h.ctx.appHost.unstage(picked.sessionId)
    // retire = 整体 dispose agent：登记全部摘除（含屏蔽断言面上的 deny——
    // disposeAll 清空 denials 记录）/ retire = dispose the agent whole: every
    // registration goes away (disposeAll clears the denials record too)
    expect(scope.registry.size).toBe(0)
    expect(scope.denials).toEqual([])
    // 索引行翻废弃；会话不再属于该应用 / the row flips deprecated; the session no longer owns the app
    const rows = await h.pages.instances.listByApp('mini')
    expect(rows.some((row) => row.sessionId === picked.sessionId && row.state === 'live')).toBe(false)
    expect(await h.ctx.appHost.sessionApp(picked.sessionId)).toBeNull()
  })

  it('装配 disposer 撤销全部注入：dispose 后镜像失效（注册只告警不镜像）', async () => {
    const ctx = new Context()
    ;(ctx.provide as unknown as (n: string, v: unknown) => void)('sessions', { get: () => undefined, create: () => ({}) })
    ;(ctx.provide as unknown as (n: string, v: unknown) => void)('agents', { get: () => undefined })
    ;(ctx.provide as unknown as (n: string, v: unknown) => void)('skills', { register: () => () => undefined })
    await ctx.plugin(Storage.default)
    const jsonFiber = await ctx.plugin(StorageJson, { root: tempRoot() })
    await ctx.plugin(StorageDomain, { backend: 'json' })
    await ctx.plugin(AppRegistryPlugin)
    await ctx.plugin(PageRegistryPlugin)
      await ctx.plugin(TaskCenterPlugin)
      const fiber = await ctx.plugin({ name, inject, apply, Config }, { enabled: true })
    await fiber.await()
    await fiber.dispose() // 卸载装配层
    const apps = ctx.apps
    const warnings: string[] = []
    const original = ctx.logger.warn
    ;(ctx.logger as { warn: (m: string) => void }).warn = (m: string) => { warnings.push(m) }
    try {
      apps.register({ id: 'solo' as AppId, name: 'solo', description: 'd', entry: 'main' as PageKey })
      apps.pages('solo' as AppId).register(
        () => createElement('p', { children: 'main' }),
        { url: '/apps/solo/main', description: 'd' },
      )
      expect(warnings.some((m) => m.includes('no page mirror wired'))).toBe(true)
      expect(ctx.pageRegistry.resolve('/apps/solo/main')).toBeNull() // 未镜像
    } finally {
      ;(ctx.logger as { warn: (m: string) => void }).warn = original
      await jsonFiber.dispose().catch(() => undefined)
    }
  })

  it('§3.9 完备性警告在挂载期判（判据=真实登记差集）：writes:true + 零登记仍告警，viewer 与组件体登记者沉默', async () => {
    // 回归钉（一次性渲染时代）：告警在挂载期、判据是真实登记差集——注册期看不到
    // 组件体的 agent.ctx.tools.register，在那里判必然误报；viewer（只读）与组件体
    // 登记了工具的页面必须沉默。
    // / regression pin (the one-shot era): the warning is judged at mount over the
    // really-registered delta — registration never sees the body's
    // agent.ctx.tools.register, so judging there would misfire; viewers and pages
    // whose body registers tools must stay silent.
    const h = await boot({ enabled: false })
    const apps = h.ctx.apps
    apps.register({ id: 'lazy' as AppId, name: 'lazy', description: 'd', entry: 'main' as PageKey }, h.ctx)
    const pages = apps.pages('lazy' as AppId, h.ctx)
    pages.register(
      () => createElement('p', { children: 'main' }),
      { url: '/apps/lazy/main', description: 'd' },
    )
    pages.register(
      // viewer：带参、只读、零登记——警告对它必须沉默
      // / the viewer: parameterized, read-only, no registrations — the warning must stay silent
      () => createElement('p', { children: 'ws' }),
      { url: '/apps/lazy/ws/:id', description: 'd' },
    )
    pages.register(
      // action：writes: true + 零登记——挂载时警告必须照常打出
      // / the action page: writes: true + no registrations — the warning must still fire at mount
      () => createElement('p', { children: 'publish' }),
      { url: '/apps/lazy/publish', description: 'd', writes: true, instructions: '确认后发布' },
    )
    pages.register(
      // 动态登记者：writes: true、零静态声明，但组件体登记了工具——必须沉默
      // / a dynamic declarer: writes: true, empty static list, but the body registers tools — must stay silent
      (_props, agent) => {
        agent.ctx.tools.register(defineTool({
          name: 'lazy__publish_now', description: '发布', parameters: {},
          output: { schema: { type: 'object', additionalProperties: true } as const, render: () => [] },
          execute: async () => ({ ok: true }),
        }))
        return createElement('p', { children: 'wire' })
      },
      { url: '/apps/lazy/wire', description: 'd', writes: true, instructions: '确认后发布' },
    )
    wireAppHost(h.ctx)
    const warnings: string[] = []
    const original = h.ctx.logger.warn
    ;(h.ctx.logger as { warn: (m: string) => void }).warn = (m: string) => { warnings.push(m) }
    try {
      await h.pages.openUrl('/apps/lazy/publish')
      await h.pages.openUrl('/apps/lazy/wire')
      const coverage = warnings.filter((m) => m.includes('declares writes: true but mounts no tools'))
      expect(coverage).toHaveLength(1)
      expect(coverage[0]).toContain('lazy/publish') // 警告点名的是 pageKey / the warning names the pageKey
      expect(coverage[0]).not.toContain('lazy/ws')
      expect(coverage[0]).not.toContain('lazy/wire')
    } finally {
      ;(h.ctx.logger as { warn: (m: string) => void }).warn = original
    }
  })
})
