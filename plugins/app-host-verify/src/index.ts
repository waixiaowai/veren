/**
 * 真机验证探针（只在隔离测试 profile 里装）：在真实宿主进程内跑六项检查，
 * 结果写 JSON（config.outputPath）。
 * Real-host verification probe (isolated test profiles only): runs the six
 * phase-2 checks inside the real host process and writes a JSON verdict.
 *
 * 六项 / the six checks:
 * 1. ctx.apps / ctx.pageRegistry / ctx.taskCenter 可解析（装配按依赖序生效）；
 * 2. agent/created 真实载荷形状（记录键与 agent 字段，供比对替身假设）；
 * 3. 真实会话里打开 /apps/task-workbench/task/1 与 /list：真实会话被创建；
 * 4. 两个真实会话的工具互不可见（list 页无 abandon_task，detail 页无 take_task）；
 * 5. 重开同一 URL 回到原会话（真实 SessionStore 持久化，非替身）；
 * 6. 任务通知经真实 followup 落进真实会话日志（投递泵跑在真宿主上）。
 * @module @veren/app-host-verify
 */
import { writeFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
// 类型-only import：拉取各包的 declaration merging——ctx.apps / ctx.pageRegistry /
// ctx.taskCenter / ctx.tools / ctx.sessions / ctx.agents 直接用真实服务面，
// 不手写第二遍结构。
// Type-only imports: pull each package's declaration merging so ctx.apps,
// ctx.pageRegistry, ctx.taskCenter, ctx.tools, ctx.sessions and ctx.agents all
// resolve to their real service faces — no hand-written structural copies.
import type {} from '@veren/app-registry'
import type {} from '@veren/page-registry'
import type {} from '@veren/task-center'
import type {} from '@deepseek-ai/dsh-tools'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session'
// 运行时值：官方品牌构造——裸 string 升格为品牌 id，不用 as 断言。
// Runtime values: official brand constructors — promote bare strings without casts.
import { canonicalizePageUrl } from '@veren/prompt-page'
import type { TaskDraft } from '@veren/task-center'

// 诊断标记：import 即写；apply 进入即写。区分「没 import / 没 apply / 流程挂起」。
// Diagnostic markers: one at import time, one at apply entry; tells "not imported",
// "not applied", and "flow hung" apart.
try { writeFileSync(new URL('../../../deepseek/.dsh/profiles/web/app-host-verify-result.json.imported', import.meta.url), new Date().toISOString()) } catch { /* 仅标记 / marker only */ }

export const name = 'veren-app-host-verify'

export interface Config {
  /** 验收结果 JSON 输出路径 / where the verdict JSON is written */
  outputPath: string
  /** 是否执行（默认开；patch 里显式给 true） / whether to run (default true) */
  run: boolean
}

export const Config: z<Config> = z.object({
  outputPath: z.string().description('验收结果 JSON 输出路径 / where the verdict JSON is written'),
  run: z.boolean().default(true).description('是否执行验证 / whether to run the verification'),
})

export const inject = ['apps', 'pageRegistry', 'taskCenter', 'sessions', 'agents', 'tools']
export const provide = []

/** 一项检查的结论 / one check's verdict */
interface Check {
  readonly name: string
  pass: boolean
  detail: string
}

function check(name: string, pass: boolean, detail: string): Check {
  return { name, pass, detail }
}

/** agent 作用域里的工具名集合（ctx.tools 真实 scope 解析）/ tool names visible in one agent's scope */
function scopedToolNames(agentCtx: Context, names: readonly string[]): string[] {
  const runtime = agentCtx.tools
  if (runtime === undefined) return []
  return names.filter((n) => runtime.get(n) !== undefined)
}

/** 真实会话日志里是否出现某段文本（防呆：JSON 串行化整份事件日志再查子串） */
function sessionContains(agent: Agent, needle: string): boolean {
  const haystack = JSON.stringify({ log: agent.session.snapshotEvents() }) ?? ''
  return haystack.includes(needle)
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export const apply = (ctx: Context, config: Config): void => {
  try { writeFileSync(config.outputPath + '.activated', `${new Date().toISOString()} run=${String(config.run)} path=${config.outputPath}`) } catch { /* 仅标记 / marker only */ }
  if (!config.run) return
  const checks: Check[] = []
  const agentCreatedPayloads: Array<{ agent: Agent; source: unknown }> = []
  // agent/created 走 dsh-agent 的 declaration merging 真实事件类型，无断言。
  // The agent/created event uses dsh-agent's merged event type — no casts.
  ctx.on('agent/created', (payload) => {
    agentCreatedPayloads.push(payload)
    return undefined
  })
  const finish = (): void => {
    // Real agent payloads can be circular: serialize per-section and degrade to a
    // shape summary instead of losing the whole verdict.
    // 真 agent 载荷可能有环：分段序列化，失败降级为形状摘要，不丢整份 verdict。
    const safe = (value: unknown): unknown => {
      try { return JSON.parse(JSON.stringify(value, (_, item) => typeof item === 'function' ? 'fn' : item)) } catch { return `<unserializable: ${String(value)}>` }
    }
    try {
      writeFileSync(config.outputPath, JSON.stringify({ checks, agentCreatedPayloads: safe(agentCreatedPayloads) }, null, 2))
    } catch (error: unknown) {
      try {
        writeFileSync(config.outputPath, JSON.stringify({ checks, agentCreatedPayloads: '<unserializable>', finishError: String(error) }, null, 2))
      } catch { ctx.logger.error(`app-host-verify: could not write verdict: ${String(error)}`) }
    }
  }
  // 全局看门狗：任何挂起也落盘 verdict，并指认最后到达的步骤（60s）。
  // Global watchdog: any hang still lands a verdict naming the last step reached.
  let lastStep = 'start'
  const watchdog = setTimeout(() => {
    checks.push(check('watchdog', false, `flow hung after step "${lastStep}"`))
    finish()
  }, 60_000)
  void (async () => {
    try {
      lastStep = 'services'

      // 1) 三个服务可解析 / the three services resolve
      const servicesOk = ctx.apps !== undefined && ctx.pageRegistry !== undefined && ctx.taskCenter !== undefined
      checks.push(check('1.services-resolve', servicesOk,
        `apps=${typeof ctx.apps} pageRegistry=${typeof ctx.pageRegistry} taskCenter=${typeof ctx.taskCenter}`))
      if (!servicesOk) return

      // 3) 打开 list 页。行激活无全局顺序：先等应用页面落进 URL 索引（最多 ~10s）。
      //    Row activation has no global ordering: wait for the page to land (≤10s).
      lastStep = 'openUrl-list'
      let list: { sessionId: string; created: boolean } | undefined
      for (let waited = 0; ; waited += 200) {
        try {
          list = await ctx.pageRegistry.openUrl('/apps/task-workbench/list')
          break
        } catch {
          if (waited >= 10_000) {
            // 诊断：注册到底发生了什么（目录/解析面/装配状态原样落盘）
            // Diagnostics: dump catalog/resolve state as-is for the verdict.
            const pages = ctx.apps.catalog().flatMap((record) => ctx.apps.listPages(record.definition.id))
            const byName = ctx.pageRegistry.get('list')
            const byUrl = ctx.pageRegistry.resolve('/apps/task-workbench/list')
            const dump = (value: unknown): string => JSON.stringify(value, (_, item) => typeof item === 'function' ? 'fn' : item)
            throw new Error(`pages never appeared; byName=${dump(byName)?.slice(0, 200)}; byUrl=${dump(byUrl)?.slice(0, 200)}; appPages=${dump(pages)?.slice(0, 300)}`)
          }
          await sleep(200)
        }
      }
      lastStep = 'openUrl-detail'
      const detail = await ctx.pageRegistry.openUrl('/apps/task-workbench/task/1')
      checks.push(check('3.real-sessions-created', list.created && detail.created,
        `list=${list.sessionId} detail=${detail.sessionId}`))

      // 4) 工具挂进各自 agent 作用域。agent 未激活时 create 触发；无模型凭据时
      //    create 可能长期 pending，与超时竞速保证 verdict 落盘（15s）。
      lastStep = 'agents-create'
      const withTimeout = <T>(promise: Promise<T>, label: string): Promise<T> =>
        Promise.race([promise, sleep(15_000).then(() => { throw new Error(`${label} timed out after 15000ms`) })])
      const listId = SessionId(list.sessionId)
      const detailId = SessionId(detail.sessionId)
      if (ctx.agents.get(listId) === undefined) {
        await withTimeout(ctx.agents.create({ sessionId: listId }), `agents.create(${list.sessionId})`)
      }
      if (ctx.agents.get(detailId) === undefined) {
        await withTimeout(ctx.agents.create({ sessionId: detailId }), `agents.create(${detail.sessionId})`)
      }
      lastStep = 'tool-visibility'
      const listAgent = ctx.agents.get(listId)
      const detailAgent = ctx.agents.get(detailId)
      const names = ['task_workbench__take_task', 'task_workbench__complete_task', 'task_workbench__abandon_task']
      const listTools = listAgent ? scopedToolNames(listAgent.ctx, names) : []
      const detailTools = detailAgent ? scopedToolNames(detailAgent.ctx, names) : []
      checks.push(check('4.scoped-visibility', listTools.includes('task_workbench__take_task') && !listTools.includes('task_workbench__abandon_task')
        && detailTools.includes('task_workbench__abandon_task') && !detailTools.includes('task_workbench__take_task'),
      `list scope=[${listTools.join(',')}] detail scope=[${detailTools.join(',')}]`))

      // 2) agent/created 真实载荷形状 / real agent/created payload shape
      lastStep = 'agent-created-payload'
      const payload = agentCreatedPayloads[0]
      checks.push(check('2.agent-created-payload', payload !== undefined && payload.agent !== undefined,
        `payloadKeys=${payload ? Object.keys(payload).join(',') : 'none'}; agentKeys=${payload ? Object.keys(payload.agent).join(',') : 'none'}`))

      // 5) 重开同一 URL 回到原会话 / reopening the same URL returns the original session
      lastStep = 'reopen'
      const reopened = await ctx.pageRegistry.openUrl('/apps/task-workbench/task/1')
      checks.push(check('5.reopen-reuses-session', !reopened.created && reopened.sessionId === detail.sessionId,
        `reopened=${reopened.sessionId} created=${reopened.created}`))

      // 6) 任务通知经真实 followup 落进真实会话日志 / the task notice lands in the real session log
      lastStep = 'notice'
      const task = await ctx.taskCenter.send({
        // TaskKind 无官方构造器，沿用仓库先例（task-workbench/app.ts）的品牌升格。
        // TaskKind has no official constructor; follow the repo precedent (task-workbench/app.ts).
        kind: 'task-workbench/verify' as TaskDraft['kind'],
        title: '真机验证任务',
        target: {
          url: canonicalizePageUrl('/apps/task-workbench/task/1'),
          appId: 'task-workbench',
          page: 'detail',
          params: { taskId: '1' },
        },
      })
      await ctx.pageRegistry.openUrl('/apps/task-workbench/task/1', { taskId: task.id })
      await sleep(1_000)
      const detailAgent3 = ctx.agents.get(detailId)
      const delivered = detailAgent3 !== undefined && sessionContains(detailAgent3, '[task-center]')
      checks.push(check('6.notice-in-real-session-log', delivered,
        delivered ? 'notice text found in the real session log' : 'notice text NOT found in the session log'))
    } catch (error: unknown) {
      checks.push(check('probe-error', false, `${String(error)} (lastStep=${lastStep})`))
    } finally {
      clearTimeout(watchdog)
      finish()
    }
  })()
}
