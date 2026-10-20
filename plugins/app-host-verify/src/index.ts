/**
 * 真机验证探针（只在隔离测试 profile 里装）：在真实宿主进程内跑六项检查，
 * 结果写 JSON（config.outputPath）。
 * Real-host verification probe (isolated test profiles only): runs the six
 * phase-2 checks inside the real host process and writes a JSON verdict.
 *
 * 六项：
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
import type { PageInstanceKey } from '@veren/prompt-page'

// 诊断标记：import 即写；apply 进入即写。区分「没 import / 没 apply / 流程挂起」。
// Diagnostic markers: one at import time, one at apply entry; tells "not imported",
// "not applied", and "flow hung" apart.
try { writeFileSync(new URL('../../../deepseek/.dsh/profiles/web/app-host-verify-result.json.imported', import.meta.url), new Date().toISOString()) } catch { /* marker only */ }

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

/** 宿主面的结构性读取（探针只在真宿主里跑，读到啥记啥，不假装） */
function hostFaces(ctx: Context) {
  return ctx as unknown as {
    apps?: { catalog(): unknown[]; listPages(id: string): unknown[] }
    pageRegistry?: { openUrl(url: string, o?: object): Promise<{ sessionId: string; created: boolean }> }
    taskCenter?: { send(d: unknown): Promise<{ id: string }>; get(id: string): Promise<{ status?: string } | undefined> }
    sessions?: unknown
    agents?: {
      get(id: string): { ctx: Context; session: { id: string; log?: unknown[]; messages?: unknown[] }; followup(m: unknown): void } | undefined
      create(o: { sessionId: string }): Promise<unknown>
    }
  }
}

/** agent 作用域里的工具名集合（ToolRuntime 真实 scope 解析） */
function scopedToolNames(agentCtx: Context, names: readonly string[]): string[] {
  const runtime = (agentCtx as { tools?: { get(name: string): { name: string } | undefined } }).tools
  if (runtime === undefined) return []
  return names.filter((n) => runtime.get(n) !== undefined)
}

/** 真实会话日志里是否出现某段文本（防御式：不同版本的日志面字段都试一遍） */
function sessionContains(agent: { session: { log?: unknown; messages?: unknown } }, needle: string): boolean {
  const haystack = JSON.stringify({ log: agent.session.log, messages: agent.session.messages }) ?? ''
  return haystack.includes(needle)
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

export const apply = (ctx: Context, config: Config): void => {
  try { writeFileSync(config.outputPath + '.activated', `${new Date().toISOString()} run=${String(config.run)} path=${config.outputPath}`) } catch { /* marker only */ }
  if (!config.run) return
  const checks: Check[] = []
  const agentCreatedPayloads: unknown[] = []
  ;(ctx.on as unknown as (e: string, l: (p: unknown) => void) => void)('agent/created', (p: unknown) => {
    agentCreatedPayloads.push(p)
  })
  const finish = (): void => {
    // Real agent payloads can be circular: serialize per-section and degrade to a
    // shape summary instead of losing the whole verdict.
    // 真 agent 载荷可能有环：分段序列化，失败降级为形状摘要，不丢整份 verdict。
    const safe = (value: unknown): unknown => {
      try { return JSON.parse(JSON.stringify(value, (_, item) => typeof item === 'function' ? 'fn' : item)) } catch { return `<unserializable: ${String(value)?.constructor?.name ?? typeof value}>` }
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
      const host = hostFaces(ctx)
      lastStep = 'services'

      // 1) 三个服务可解析
      const servicesOk = host.apps !== undefined && host.pageRegistry !== undefined && host.taskCenter !== undefined
      checks.push(check('1.services-resolve', servicesOk,
        `apps=${typeof host.apps} pageRegistry=${typeof host.pageRegistry} taskCenter=${typeof host.taskCenter}`))
      if (!servicesOk) return

      // 3) 打开 list 页。行激活无全局顺序：先等应用页面落进 URL 索引（最多 ~10s）。
      //    Row activation has no global ordering: wait for the page to land (≤10s).
      lastStep = 'openUrl-list'
      let list: { sessionId: string; created: boolean } | undefined
      for (let waited = 0; ; waited += 200) {
        try {
          list = await host.pageRegistry!.openUrl('/apps/task-workbench/list')
          break
        } catch {
          if (waited >= 10_000) {
            const pages = (host.apps as { listPages(id: string): unknown[] }).listPages('task-workbench')
            const pr = host.pageRegistry as { get(name: string): unknown; resolve(url: string): unknown }
            const dump = (value: unknown): string => JSON.stringify(value, (_, item) => typeof item === 'function' ? 'fn' : item)
            throw new Error(`pages never appeared; byName=${dump(pr.get?.('list'))?.slice(0, 200)}; byUrl=${dump(pr.resolve?.('/apps/task-workbench/list'))?.slice(0, 200)}; appPages=${dump(pages)?.slice(0, 300)}`)
          }
          await sleep(200)
        }
      }
      lastStep = 'openUrl-detail'
      const detail = await host.pageRegistry!.openUrl('/apps/task-workbench/task/1' as PageInstanceKey)
      checks.push(check('3.real-sessions-created', list.created && detail.created,
        `list=${list.sessionId} detail=${detail.sessionId}`))

      // 4) 工具挂进各自 agent 作用域。agent 未激活时 create 触发；无模型凭据时
      //    create 可能长期 pending，与超时竞速保证 verdict 落盘（15s）。
      lastStep = 'agents-create'
      const withTimeout = <T>(promise: Promise<T>, label: string): Promise<T> =>
        Promise.race([promise, sleep(15_000).then(() => { throw new Error(`${label} timed out after 15000ms`) })])
      if (host.agents?.get(list.sessionId) === undefined) {
        await withTimeout(host.agents!.create({ sessionId: list.sessionId }), `agents.create(${list.sessionId})`)
      }
      if (host.agents?.get(detail.sessionId) === undefined) {
        await withTimeout(host.agents!.create({ sessionId: detail.sessionId }), `agents.create(${detail.sessionId})`)
      }
      lastStep = 'tool-visibility'
      const listAgent = host.agents?.get(list.sessionId)
      const detailAgent = host.agents?.get(detail.sessionId)
      const names = ['task_workbench__take_task', 'task_workbench__complete_task', 'task_workbench__abandon_task']
      const listTools = listAgent ? scopedToolNames(listAgent.ctx, names) : []
      const detailTools = detailAgent ? scopedToolNames(detailAgent.ctx, names) : []
      checks.push(check('4.scoped-visibility', listTools.includes('task_workbench__take_task') && !listTools.includes('task_workbench__abandon_task')
        && detailTools.includes('task_workbench__abandon_task') && !detailTools.includes('task_workbench__take_task'),
      `list scope=[${listTools.join(',')}] detail scope=[${detailTools.join(',')}]`))

      // 2) agent/created 真实载荷形状
      lastStep = 'agent-created-payload'
      const payload = agentCreatedPayloads[0] as { agent?: unknown } | undefined
      checks.push(check('2.agent-created-payload', payload !== undefined && (payload as { agent?: { session?: unknown; ctx?: unknown } }).agent !== undefined,
        `payloadKeys=${payload ? Object.keys(payload).join(',') : 'none'}; agentKeys=${payload !== null && typeof payload?.agent === 'object' ? Object.keys(payload.agent).join(',') : 'none'}`))

      // 5) 重开同一 URL 回到原会话
      lastStep = 'reopen'
      const reopened = await host.pageRegistry!.openUrl('/apps/task-workbench/task/1' as PageInstanceKey)
      checks.push(check('5.reopen-reuses-session', !reopened.created && reopened.sessionId === detail.sessionId,
        `reopened=${reopened.sessionId} created=${reopened.created}`))

      // 6) 任务通知经真实 followup 落进真实会话日志
      lastStep = 'notice'
      const task = await host.taskCenter!.send({
        kind: 'task-workbench/verify',
        title: '真机验证任务',
        target: { url: '/apps/task-workbench/task/1', appId: 'task-workbench', page: 'detail', params: { taskId: '1' } },
      })
      await host.pageRegistry!.openUrl('/apps/task-workbench/task/1' as PageInstanceKey, { taskId: task.id })
      await sleep(1_000)
      const detailAgent3 = host.agents?.get(detail.sessionId)
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
