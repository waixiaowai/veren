/**
 * @veren/im-turn plugin entry: opens the turn domain, assembles run records,
 * session provisioning, and the runner, consumes wake requests, and publishes
 * the turn service (run listing for observability).
 *
 * @veren/im-turn 插件入口：打开回合域，组装运行记录、会话筹备与执行器，消费唤醒请求，并
 * 发布回合服务（面向观测面的运行清单）。
 *
 * @module @veren/im-turn
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import './events.ts'
import { RunStore, turnDomain } from './runs.ts'
import { Sessions } from './sessions.ts'
import { Runner } from './runner.ts'
import { TurnService, TurnToken } from './service.ts'

export * from './types.ts'
export { RunStore, fingerprintOf, turnDomain } from './runs.ts'
export type { AgentSessionRow, RunRow, RunEventRow, TurnStore, TurnTables } from './runs.ts'
export { Sessions, presetOfAgent } from './sessions.ts'
export { MAX_GATE_ROUNDS, Runner } from './runner.ts'
export type { RunnerOptions } from './runner.ts'
export { MAX_PROMPT_MESSAGES, buildHoldPrompt, buildPrompt } from './prompt.ts'
export { TurnService, TurnToken } from './service.ts'
export type { SessionPlace } from './service.ts'
export type { ImRunUpdated } from './events.ts'

/** Plugin name. */
/** 插件名。 */
export const name = 'imTurn'

/**
 * Host services: durable storage, the conversation/coordination faces, the
 * roster, and agent memory; session work adds the host's agent services
 * (`agents`, `agentDefaultModel`, `workspaceRegistry`).
 * 宿主服务：持久存储、会话/协调面、名册与智能体记忆；会话工作还需要宿主的 agent 服务
 * （`agents`、`agentDefaultModel`、`workspaceRegistry`）。
 */
export const inject = [
  'storageDomain', 'agents', 'agentDefaultModel', 'workspaceRegistry',
  'imConversation', 'imCoordination', 'imParticipants', 'imMemory',
] as const
/** Services this plugin provides. */
/** 本插件提供的服务。 */
export const provide = [TurnToken] as const

/** Plugin configuration. */
/** 插件配置。 */
export interface Config {
  /** Maximum wait for one session turn (hard boundary). */
  /** 单次会话回合的最大等待（硬边界）。 */
  replyTimeoutMs: number
}
/** Configuration schema. */
/** 配置 schema。 */
export const Config: z<Config> = z.object({
  replyTimeoutMs: z.number().min(1).default(120_000),
})

/**
 * Apply the turn plugin. The turn domain opens once and feeds both the run
 * store and the agent-session map.
 * 应用回合插件。回合域只打开一次，同时供养运行记录与智能体会话映射。
 *
 * @param ctx - host context.
 * @param config - validated plugin configuration.
 */
export const apply = async (ctx: Context, config: Config): Promise<void> => {
  const domain = await openDomain(ctx)
  ctx.effect(() => () => domain.close(), 'im-turn:storage')
  const sessionMap = domain.table('agent_sessions')

  const runs = buildRunStore(domain)
  const sessions = wireSessions(ctx, sessionMap)
  wireRunner(ctx, config, runs, sessions)
  ctx.effect(
    () => ctx.provide(TurnToken, new TurnService(runs, () => [...sessionMap.entries()].map(([, row]) => row))),
    'im-turn:service',
  )
}

/** Open the turn domain (typed alias for the helper's parameter). */
/** 打开回合域（助手参数的类型别名）。 */
function openDomain(ctx: Context): Promise<import('@deepseek-ai/dsh-storage-domain').Domain<typeof turnDomain>> {
  return ctx.storageDomain.open(turnDomain)
}

/** Assemble the run store over the opened domain. */
/** 在已打开的域之上组装运行存储。 */
type TurnDomainHandle = Awaited<ReturnType<typeof openDomain>>

/** Assemble the run store over the opened domain. */
/** 在已打开的域之上组装运行存储。 */
function buildRunStore(domain: TurnDomainHandle): RunStore {
  const runs = new RunStore()
  runs.attach({
    getRun: id => domain.table('runs').get(id),
    runs: () => [...domain.table('runs').entries()].map(([, row]) => row),
    putRun: async row => {
      await domain.table('runs').put(row.id, row)
    },
    events: () => [...domain.table('run_events').entries()].map(([, row]) => row),
    putEvent: async row => {
      await domain.table('run_events').put(row.id, row)
    },
  })
  return runs
}

/** One agent-session map row, structurally (keeps the helper free of imports). */
/** 一行智能体会话映射，按结构给类型（让助手免于额外导入）。 */
interface SessionMapRowLike {
  key: string
  session_id: string
  updated_at: number
}

/** Wire session provisioning over the agent-session map. */
/** 在智能体会话映射之上接线会话筹备。 */
function wireSessions(ctx: Context, sessionMap: {
  get(key: string): SessionMapRowLike | undefined
  put(key: string, row: SessionMapRowLike): Promise<void>
}): Sessions {
  const sessions = new Sessions({
    ctx,
    lookup: key => sessionMap.get(key)?.session_id,
    remember: async (key, sessionId) => {
      await sessionMap.put(key, { key, session_id: sessionId, updated_at: Date.now() })
    },
  })
  ctx.effect(() => () => sessions.dispose(), 'im-turn:sessions')
  return sessions
}

/** Wire the runner and its wake subscription. */
/** 接线执行器与其唤醒订阅。 */
function wireRunner(ctx: Context, config: Config, runs: RunStore, sessions: Sessions): void {
  const runner = new Runner({
    ctx,
    conversation: ctx.imConversation,
    coordination: ctx.imCoordination,
    participants: ctx.imParticipants,
    runs,
    sessions,
    replyTimeoutMs: config.replyTimeoutMs,
  })
  ctx.effect(
    () => ctx.on('im/wake-request', request => runner.onWake(request)),
    'im-turn:wake',
  )
  // Registered last so it runs first on unload.
  // 最后注册、卸载时最先执行。
  ctx.effect(() => () => runner.dispose(), 'im-turn:runner-dispose')
}
