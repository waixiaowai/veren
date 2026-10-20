/**
 * 真机验证探针（只在隔离测试 profile 里装）：在真实宿主进程内跑六项检查，
 * 结果写 JSON（config.outputPath）。检查项见 {@link runChecks}。
 * Real-host verification probe (isolated test profiles only): runs the six
 * phase-2 checks inside the real host process and writes a JSON verdict.
 *
 * 六项：
 * 1. ctx.apps / ctx.pageRegistry / ctx.taskCenter 可解析（装配按依赖序生效）；
 * 2. agent/created 真实载荷形状（记录键与 agent 字段，供比对替身假设）；
 * 3. 真实会话里打开 /apps/task-workbench/task/1 与 /list：页面工具分别挂进
 *    各自 agent 作用域（list 页有 take_task 无 abandon_task，detail 页相反
 *    ——工具集合不同才证得出"互不可见"，同名集合证不出）；
 * 4. 反向可见性：list 的 agent 看不到 abandon_task，detail 的 agent 看不到
 *    take_task（跨会话零泄漏）；
 * 5. 重开同一 URL 回到原会话（真实 SessionStore 持久化，非替身）；
 * 6. 任务通知经真实 followup 落进真实会话日志（投递泵跑在真宿主上）。
 * @module @veren/app-host-verify
 */
import { writeFileSync } from 'node:fs'
import type { Context } from '@deepseek-ai/cordis'
import type { PageInstanceKey } from '@veren/prompt-page'

export const name = 'veren-app-host-verify'

export interface Config {
  /** 验收结果 JSON 输出路径 / where the verdict JSON is written */
  outputPath: string
  /** 是否执行（默认开；overlay patch 里显式给 true） */
  run: boolean
}

export const Config = {
  type: 'object' as const,
  properties: {
    outputPath: { type: 'string', description: '验收结果 JSON 输出路径' },
    run: { type: 'boolean', default: true, description: '是否执行验证' },
  },
} as const

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
  const host = ctx as unknown as {
    apps?: { catalog(): unknown[]; listPages(id: string): unknown[] }
    pageRegistry?: { openUrl(url: string, o?: object): Promise<{ sessionId: string; created: boolean }> }
    taskCenter?: { send(d: unknown): Promise<{ id: string }>; get(id: string): Promise<{ status?: string } | undefined> }
    sessions?: unknown
    agents?: { get(id: string): { ctx: Context; session: { id: string; log?: unknown[]; messages?: unknown[] }; followup(m: unknown): void } | undefined; create(o: { sessionId: string }): Promise<unknown> }
  }
  return host
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

export const apply = (ctx: Context, config: Config): void => {
  if (!config.run) return
  const checks: Check[] = []
  const agentCreatedPayloads: unknown[] = []
  ;(ctx.on as unknown as (e: string, l: (p: unknown) => void) => void)('agent/created', (p: unknown) => {
    agentCreatedPayloads.push(p)
  })
  const finish = (): void => {
    try {
      writeFileSync(config.outputPath, JSON.stringify({ checks, agentCreatedPayloads }, null, 2))
      ctx.logger.info(`app-host-verify: verdict written to ${config.outputPath} (${checks.filter((c) => c.pass).length}/${checks.length} passed)`)
    } catch (error: unknown) {
      ctx.logger.error(`app-host-verify: could not write verdict: ${String(error)}`)
    }
  }
  // 等 task-workbench 的页面注册与装配完成；整个流程异步跑，结束写文件
  void (async () => {
    try {
      const host = hostFaces(ctx)

      // 1) 三个服务可解析
      const servicesOk = host.apps !== undefined && host.pageRegistry !== undefined && host.taskCenter !== undefined
      checks.push(check('1.services-resolve', servicesOk,
        `apps=${typeof host.apps} pageRegistry=${typeof host.pageRegistry} taskCenter=${typeof host.taskCenter}`))
      if (!servicesOk) return

      // 3+4) 两个真实会话：list 页与 detail 页，工具集合不同
      const list = await host.pageRegistry!.openUrl('/apps/task-workbench/list')
      const detail = await host.pageRegistry!.openUrl('/apps/task-workbench/task/1' as PageInstanceKey)
      checks.push(check('3.real-sessions-created', list.created && detail.created,
        `list=${list.sessionId} detail=${detail.sessionId}`))
      const agentList = host.agents?.get(list.sessionId)
      const agentDetail = host.agents?.get(detail.sessionId)
      if (agentList === undefined || agentDetail === undefined) {
        // 无活 agent：页面工具在 app-host 的等待队列里。创建真实 agent 触发挂载。
        await host.agents?.create({ sessionId: list.sessionId })
        await host.agents?.create({ sessionId: detail.sessionId })
      }
      const listAgent2 = host.agents?.get(list.sessionId)
      const detailAgent2 = host.agents?.get(detail.sessionId)
      const listTools = listAgent2 ? scopedToolNames(listAgent2.ctx, ['task_workbench__take_task', 'task_workbench__complete_task', 'task_workbench__abandon_task']) : []
      const detailTools = detailAgent2 ? scopedToolNames(detailAgent2.ctx, ['task_workbench__take_task', 'task_workbench__complete_task', 'task_workbench__abandon_task']) : []
      checks.push(check('4.scoped-visibility', listTools.includes('task_workbench__take_task') && !listTools.includes('task_workbench__abandon_task')
        && detailTools.includes('task_workbench__abandon_task') && !detailTools.includes('task_workbench__take_task'),
        `list scope=[${listTools.join(',')}] detail scope=[${detailTools.join(',')}]`))

      // 2) agent/created 真实载荷形状
      const payload = agentCreatedPayloads[0] as { agent?: unknown } | undefined
      checks.push(check('2.agent-created-payload', payload !== undefined && (payload as { agent?: { session?: unknown; ctx?: unknown } }).agent !== undefined,
        `payloadKeys=${payload ? Object.keys(payload).join(',') : 'none'}; agentKeys=${payload && typeof payload.agent === 'object' && payload.agent !== null ? Object.keys(payload.agent).join(',') : 'none'}`))

      // 5) 重开同一 URL 回到原会话
      const reopened = await host.pageRegistry!.openUrl('/apps/task-workbench/task/1' as PageInstanceKey)
      checks.push(check('5.reopen-reuses-session', !reopened.created && reopened.sessionId === detail.sessionId,
        `reopened=${reopened.sessionId} created=${reopened.created}`))

      // 6) 任务通知经真实 followup 落进真实会话日志
      const task = await host.taskCenter!.send({
        kind: 'task-workbench/verify',
        title: '真机验证任务',
        target: { url: '/apps/task-workbench/task/1', appId: 'task-workbench', page: 'detail', params: { taskId: '1' } },
      })
      // 打开即接取（openUrl 带 taskId）→ 投递泵把通知 followup 进该会话
      await host.pageRegistry!.openUrl('/apps/task-workbench/task/1' as PageInstanceKey, { taskId: task.id })
      const detailAgent3 = host.agents?.get(detail.sessionId)
      const delivered = detailAgent3 !== undefined && sessionContains(detailAgent3, '[task-center]')
      checks.push(check('6.notice-in-real-session-log', delivered,
        delivered ? 'notice text found in the real session log' : 'notice text NOT found in the session log'))
    } catch (error: unknown) {
      checks.push(check('probe-error', false, String(error)))
    } finally {
      finish()
    }
  })()
}
