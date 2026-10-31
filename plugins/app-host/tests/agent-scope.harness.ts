/**
 * agent 作用域替身 harness：每会话一个真实 cordis 子上下文，组件体在唯一一次
 * 渲染里经 `agent.ctx.tools.register` 挂进该子上下文自己的工具表。
 * The agent-scope stub harness: one real cordis child context per session; the
 * component body registers into that scope's own tool table in the one render.
 * @module tests/agent-scope.harness
 */
import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
// 与生产同型：每个 agent 一个 createScope（独立 fiber + scope tag），事件过滤才真实
// / same shape as production: one createScope per agent (own fiber + scope tag), so event filtering is real
import { createScope } from '@deepseek-ai/dsh-scope'
// 类型-only：拉取 ctx.skills 的 declaration merging（组件体直登单会话 skill 的服务面）
// type-only: declares ctx.skills — the face the body registers a single-session skill through
import type {} from '@deepseek-ai/dsh-skill'

/** 一个 agent 作用域：cordis 子上下文 + 它自己的工具表（注销器语义真实） */
export interface AgentScope {
  readonly ctx: Context
  readonly registry: Map<string, unknown>
  readonly followups: string[]
  /** restrict({deny}) 收到的工具名（屏蔽断言用）/ tool names received by restrict({deny}) */
  readonly denials: string[]
  /** 该作用域上注册的页面级 skills（按名入表）/ page-scope skills registered on this scope, by name */
  readonly skills: Map<string, unknown>
  disposeAll(): void
}

/**
 * 在隔离作用域上挂工具表替身：register 按名入表、注销器按名出表、schemas 每次
 * 从登记表拷贝快照、restrict 记下 deny——一次性渲染的工具差集与屏蔽都有断言面。
 * Provide the tool-table stub on an isolated scope: register by name, disposers
 * remove by name, schemas snapshots per call, restrict records the deny — the
 * one-shot render's tool delta and the masking both get assertion faces.
 */
function provideScopeTools(ctx: Context, registry: Map<string, unknown>, denials: string[]): void {
  ;(ctx.provide as unknown as (n: string, v: unknown) => void)('tools', {
    register: (tool: { name: string }) => {
      registry.set(tool.name, tool)
      return () => { registry.delete(tool.name) }
    },
    schemas: () => [...registry.values()].map((tool) => ({ name: (tool as { name: string }).name, description: (tool as { description?: string }).description ?? '' })),
    restrict: (filter: { deny?: readonly string[] }) => {
      denials.push(...(filter.deny ?? []))
      return () => { denials.length = 0 }
    },
  })
}

/**
 * 页面级 skills 的替身注册表：挂在 agent 作用域上（真实路径里 ctx.skills 是
 * 宿主共享实例、layer 按 agent 作用域分桶——替身直接按作用域各备一张表）。
 * The fake registry for page-scope skills: provided on the agent scope (in the
 * real path ctx.skills is the host-shared instance with per-agent layers — the
 * stub keeps one table per scope instead).
 */
function provideScopeSkills(ctx: Context, skills: Map<string, unknown>): void {
  ;(ctx.provide as unknown as (n: string, v: unknown) => void)('skills', {
    register: (skill: { name: string }) => {
      skills.set(skill.name, skill)
      return () => { skills.delete(skill.name) }
    },
  })
}

/**
 * 一个生产形状的 agent 作用域：createScope(parent, agent) 提供私有 fiber 与
 * scope tag，工具服务由该作用域自己提供。tag 必须是**同一个 agent 对象**——
 * `agentEvents(ctx, agent)` 用 agent 作 scopeTarget 的 key，事件过滤才成立。
 * 与真实 AgentRegistry 同型：在带 tag 的作用域下再 isolate('tools') 出独立工具
 * 表（否则与根 ctx 的 tools 服务同名冲突）；skills 同款 isolate('skills')（根上
 * 有 inject 替身，不 isolate 会在 provide 时撞名）。isolate 继承父的 scope tag，
 * 事件过滤仍成立。
 * Build a production-shaped agent scope: `createScope(parent, agent)` provides
 * the private fiber + scope tag, and the tools service is provided on that
 * scope. The tag must be the **same agent object** — `agentEvents(ctx, agent)`
 * uses the agent as the scopeTarget key, which is what makes event filtering
 * real. Same shape as the real AgentRegistry: isolate('tools') under the tagged
 * scope for a private tool table; skills gets the same treatment. The isolated
 * children inherit the parent's scope tag, so event filtering holds.
 * @param parent - 根测试 ctx / the root test ctx
 * @param agent - 该作用域的 agent 对象（同时是 tag）/ the agent object (also the tag)
 */
export function makeAgentScope(parent: Context, agent: Agent): AgentScope {
  const registry = new Map<string, unknown>()
  const followups: string[] = []
  const denials: string[] = []
  const skills = new Map<string, unknown>()
  const scope = createScope(parent, agent)
  const ctx = scope.ctx.isolate('tools').isolate('skills')
  provideScopeTools(ctx, registry, denials)
  provideScopeSkills(ctx, skills)
  return {
    ctx,
    registry,
    followups,
    denials,
    skills,
    disposeAll() {
      // agent fiber 销毁的注销器语义：作用域内全部登记逆序摘除
      // / the agent-fiber teardown semantics: every scope registration goes away
      void scope.dispose()
      registry.clear()
      followups.length = 0
      denials.length = 0
      skills.clear()
    },
  }
}
