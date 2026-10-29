/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 应用的两个页面（一次性渲染形态，模块级组件）：同步服务面（应用目录、工作区
 * 注册表）由组件体直读；异步面（任务中心、预设名单、模型目录）是组件体自己的
 * lifecycle——effect 取齐后以一条 followup 消息送达，失败态随消息如实渲染。
 * The app's two pages in the one-shot form as MODULE-LEVEL components: sync
 * service faces (the app catalog, the workspace registry) are read straight in
 * the body; the async faces (task center, preset roster, model catalog) are the
 * body's own lifecycle — an effect fetches them and one followup message
 * delivers the sections, failures rendered honestly in the message.
 *
 * 设计律：**工具只在页面存在**。组件体在页面会话的真实 Agent 上执行恰好一次，
 * 工具由体直接 `agent.ctx.tools.register` 登记（全名 `person_agent__<本地名>`，
 * 随 agent fiber 生灭）；session_dispatch 携带结算看守——它经
 * `agent.ctx.effect` 登记，看守随 agent 销毁结清，派给已废弃会话的回报不会悬空。
 * 单会话 skill（renhua）与工具同机制：组件体直接 `agent.ctx.skills.register`，
 * 随 agent fiber 生灭，宿主不经手挂载。
 * §3.9 承诺对齐 = "说明点名 = 这一段登记"。
 * Design law: **a tool exists only inside a page**. The body runs exactly once
 * on the page session's real Agent; tools register via `agent.ctx.tools.register`
 * directly (full names `person_agent__<local>`, living and dying with the agent
 * fiber); session_dispatch carries the settlement watch — registered via
 * `agent.ctx.effect`, the watch settles at agent disposal, so a report addressed
 * to a deprecated session never dangles. The page-scope skill (renhua) is
 * declared in meta.skills and mounted by app-host. §3.9 promise alignment =
 * "named in the instructions = registered in this block".
 * @module @veren/person-agent-app
 */
import type { ComponentPageMeta, PageFC } from '@veren/prompt-page'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-workspace'
// 类型-only：拉取 ctx.skills 的 declaration merging（单会话 skill 组件体直登的服务面）
// type-only: declares ctx.skills — the service face the body registers its single-session skill through
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@veren/app-registry'
import type {} from '@veren/task-center'
// 动作工具：复用兄弟工具包的构建器（同一份实现，页面是唯一注册面）。
// Action tools: reuse the sibling tool packages' builders (the very same
// implementations; the page is the only registration face).
import {
  buildSessionArchiveDefinition,
  buildSessionCreateDefinition,
  buildSessionDispatchDefinition,
  buildSessionPinDefinition,
  buildSessionRenameDefinition,
  buildSessionUnarchiveDefinition,
  buildSessionUnpinDefinition,
  createSettlementWatch,
} from '@veren/person-agent-tool-session'
import {
  buildWorkspaceCreateDefinition,
  buildWorkspaceRenameDefinition,
  buildWorkspaceSessionListDefinition,
} from '@veren/person-agent-tool-workspace'
// 部署事实读取：预设名单与模型目录。facts.ts 只读数、出结构化事实；标点与
// 行排版由下方正文 tsx 渲染。工作区仍由正文经工厂闭包直读注册表。
// Deployment-fact reads: the preset roster and model catalog. facts.ts only
// reads and returns structured facts; punctuation and line layout are rendered
// by the tsx body below. Workspaces stay a direct registry read via the
// factory closure.
import { errorMessage, readAgentPresets, readModelCatalogGroups } from './facts.ts'
import type { AgentPresetView, ModelCatalogGroupView } from './facts.ts'
// 页面级 skill：renhua（写给人看的文字前先加载）由两页组件体直登（与工具同
// 机制，随 agent fiber 生灭）。结算看守的默认上限单一来源（app.ts）。
// The page-scope skill: renhua (load before writing anything a human reads),
// registered by both page bodies (the same mechanism as the tools, living and
// dying with the agent fiber). The settlement watch's default bounds have one
// source (app.ts).
import { WATCH_DEFAULTS } from './app.ts'
import { loadRenhuaSkill } from './skills.ts'

/** 应用内 URL 前缀 / the app-scoped url prefix */
const URL_PREFIX = '/apps/person-agent'

/** 工具对外名：`person_agent__<本地名>`（§3.4.3）/ the external tool name */
const externalName = (localName: string): string => `person_agent__${localName}`

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
function followupText(agent: Agent, text: string): void {
  agent.followup(createUserMessage({ content: [{ type: 'text', text }], source: { kind: PAGE_SOURCE } }))
}

// ---- 概览页异步三节的文本渲染（首屏随 followup 消息送达，每节失败各自如实落地）
// ---- text renderers of the overview's three async sections (the first screen
// ---- rides one followup message; each section's failure lands honestly)

/** 预设名单节渲染成文本 / render the preset-roster section as text */
function renderPresetsSection(section: PresetsSection): string {
  if (section.error !== null && section.error !== undefined) {
    return `Agent Preset List（预设名单）读取失败：${section.error}——如实告知用户，不要编造。`
  }
  if (section.presets.length === 0) return 'Agent Preset List（预设名单）：（无可用预设）'
  const rows = section.presets.map((preset) =>
    `- ${preset.name}(${preset.id})${preset.description ? `:${preset.description}` : ''}${preset.broken ? `（不可用：${preset.broken}）` : ''}`)
  return ['Agent Preset List（预设名单）：', ...rows].join('\n')
}

/** 模型目录节渲染成文本 / render the model-catalog section as text */
function renderModelsSection(section: ModelsSection): string {
  if (section.error !== null && section.error !== undefined) {
    return `Model Catalog（模型目录）读取失败：${section.error}——如实告知用户，不要编造。`
  }
  if (section.groups.length === 0) return 'Model Catalog（模型目录）：（无可用模型）'
  const lines = ['Model Catalog（模型目录）：']
  for (const group of section.groups) {
    lines.push(`- ${group.name}(${group.id})${group.error === undefined ? '' : `: 读取失败：${group.error}`}`)
    for (const model of group.models) {
      lines.push(`  - ${model.name}(${model.id}): input ${model.inputModalities.includes('image') ? 'text+image' : 'text'}`
        + ` · ${model.contextWindow === undefined ? 'context unknown' : `context ${model.contextWindow} tokens`}`
        + (model.hint === '' ? '' : ` · use when: ${model.hint}`))
    }
  }
  return lines.join('\n')
}

/** 待办任务节渲染成文本 / render the open-tasks section as text */
function renderTasksSection(section: TasksSection): string {
  if (section.error !== null && section.error !== undefined) {
    return `待办任务读取失败：${section.error}——如实告知用户，不要编造数字。`
  }
  return `待办任务：open 任务 ${section.openCount ?? 0} 条（live 自任务中心）。`
}

/** 概览页首屏读取：三路异步读一次取齐（每节独立携带失败原因）
 * / the overview page's first-screen read: three async reads settle together (each section carries its own failure) */
async function overviewFirstScreenText(ctx: Context): Promise<string> {
  const [tasks, presets, models] = await Promise.all([
    ctx.taskCenter.list({ status: 'open' }).then(
      (openTasks) => ({ error: null, openCount: openTasks.length }) satisfies TasksSection,
      (error: unknown) => ({ error: errorMessage(error), openCount: null }) satisfies TasksSection,
    ),
    readAgentPresets(ctx).then(
      (views) => ({ error: null, presets: views }) satisfies PresetsSection,
      (error: unknown) => ({ error: errorMessage(error), presets: [] }) satisfies PresetsSection,
    ),
    readModelCatalogGroups(ctx).then(
      (groups) => ({ error: null, groups }) satisfies ModelsSection,
      (error: unknown) => ({ error: errorMessage(error), groups: [] }) satisfies ModelsSection,
    ),
  ])
  return [renderPresetsSection(presets), renderModelsSection(models), renderTasksSection(tasks)].join('\n\n')
}

// ---- 首屏快照类型（每一节独立携带失败原因——失败态也是数据）/ first-screen snapshot types (each section carries its own failure reason — failures are data) ----

/** 待办任务节 / the open-tasks section */
export interface TasksSection {
  readonly error: string | null
  readonly openCount: number | null
}
/** 预设名单节 / the preset-roster section */
export interface PresetsSection {
  readonly error: string | null
  readonly presets: readonly AgentPresetView[]
}
/** 模型目录节 / the model-catalog section */
export interface ModelsSection {
  readonly error: string | null
  readonly groups: readonly ModelCatalogGroupView[]
}
/** 概览页首屏快照 / the overview page's first-screen snapshot */
export interface OverviewFirstScreen {
  readonly tasks: TasksSection
  readonly presets: PresetsSection
  readonly models: ModelsSection
}

/**
 * 装配期绑定的模块级槽位：组件体的同步读、工具构建器与结算看守，以及 load 的
 * 异步读都从这里取本插件的 ctx。注册一定先于任何页面打开；未绑定即取 = 装配
 * 错误 fail loud。
 * The module-level slot bound at assembly time: the bodies' sync reads, the
 * tool builders, the settlement watch, and load's async reads all take this
 * plugin's ctx from here. Registration always precedes any page open; reading
 * unbound is an assembly error and fails loud.
 */
let appCtx: Context | undefined

/** 装配时绑定（index.ts 的单入口注册调用一次）/ bind at assembly time (called once by index.ts's wiring) */
export function bindPersonAgentContext(ctx: Context): void {
  appCtx = ctx
}

/** 取绑定的 ctx；未绑定 = 装配错误 fail loud / read the bound ctx; unbound = assembly error, fail loud */
function requireCtx(): Context {
  if (appCtx === undefined) {
    throw new Error('[person-agent-app] the app ctx is not bound; the app wiring must run before pages open')
  }
  return appCtx
}

// ---- 工具全名化与预挂（绑定 ctx 就绪后惰性构建；builder 产出本地名，登记即对外名）
// ---- full-naming and the prebuilt sets (built lazily once the bound ctx is
// ---- ready; builders produce local names, registration is the external name)
/** 工具全名化 / full-name a builder product */
const named = (definition: ToolDefinition): ToolDefinition => ({ ...definition, name: externalName(definition.name) })
/** 概览页的九件无状态工具（惰性首取后缓存）/ the overview's nine stateless tools (lazy, cached on first take) */
let overviewTools: readonly ToolDefinition[] | undefined
function takeOverviewTools(): readonly ToolDefinition[] {
  if (overviewTools === undefined) {
    const ctx = requireCtx()
    overviewTools = [
      named(buildSessionCreateDefinition(ctx)),
      named(buildSessionRenameDefinition(ctx)),
      named(buildSessionArchiveDefinition(ctx)),
      named(buildSessionUnarchiveDefinition(ctx)),
      named(buildSessionPinDefinition(ctx)),
      named(buildSessionUnpinDefinition(ctx)),
      named(buildWorkspaceCreateDefinition(ctx, { allowCreateDirectory: false })),
      named(buildWorkspaceRenameDefinition(ctx)),
      named(buildWorkspaceSessionListDefinition(ctx, { maxListSessions: 200 })),
    ]
  }
  return overviewTools
}
/** 工作区页的四件工具（惰性首取后缓存）/ the workspace page's four tools (lazy, cached on first take) */
let workspaceTools: readonly ToolDefinition[] | undefined
function takeWorkspaceTools(): readonly ToolDefinition[] {
  if (workspaceTools === undefined) {
    const ctx = requireCtx()
    workspaceTools = [
      named(buildWorkspaceSessionListDefinition(ctx, { maxListSessions: 200 })),
      named(buildSessionCreateDefinition(ctx)),
      named(buildWorkspaceCreateDefinition(ctx, { allowCreateDirectory: false })),
      named(buildWorkspaceRenameDefinition(ctx)),
    ]
  }
  return workspaceTools
}

// ---- 概览页（home 档 / entry）---- Overview page (the home archetype / entry) ----

/**
 * 个人工作台概览：应用目录与工作区是同步内存读——绑定 ctx 直读；预设名单、
 * 模型目录与任务中心是异步读——load 取齐（每节失败各自落地），正文如实渲染，
 * 绝不编造数字。三块名单（Workspace List / Agent Preset List / Model
 * Catalog）都在正文里，模型从正文取 id，不依赖任何隐藏的 pre-step 注入。
 * The personal workbench overview: catalog and workspaces are sync in-memory
 * reads through the bound ctx; the preset roster, model catalog and task
 * center are async reads fetched in load (each section's failure lands
 * separately), rendered honestly — never faked. All three lists live in the
 * body, so the model takes ids from the page, never from a hidden pre-step.
 */
export const OverviewPage: PageFC = (_props, agent) => {
  const ctx = requireCtx()
  // renhua 随页挂载：单会话 skill 由组件体直登（与工具同机制，随 agent fiber 生灭）。
  // renhua rides the page: the single-session skill registers in the body (the
  // same mechanism as the tools, living and dying with the agent fiber).
  agent.ctx.skills.register({ ...loadRenhuaSkill(), source: 'runtime' })
  // 本页工具（跑一次，安全）：无状态九件就地登记；session_dispatch 连同本页
  // 自己的结算看守经 agent.ctx.effect 登记——看守随 agent 销毁结清，派给已
  // 废弃会话的回报不会悬空。登记即承诺：instructions 点名 session_dispatch。
  // This page's tools (run once, safe): the nine stateless tools register in
  // place; session_dispatch together with this page's own settlement watch
  // registers via agent.ctx.effect — the watch settles at agent disposal, so
  // a report addressed to a deprecated session never dangles. Registration is
  // the promise: instructions name session_dispatch.
  for (const tool of takeOverviewTools()) agent.ctx.tools.register(tool)
  agent.ctx.effect(() => {
    const watch = createSettlementWatch(ctx, WATCH_DEFAULTS)
    agent.ctx.tools.register(named(buildSessionDispatchDefinition(ctx, watch)))
    return () => { watch.dispose() }
  }, 'person-agent:dispatch-watch')
  // 首屏读取：三路异步读是组件体自己的 lifecycle——effect 取齐后以一条消息
  // 送达（宿主不经手取数），每节失败在消息里如实落地。
  // / the first-screen read: the three async reads are the body's own lifecycle —
  // an effect fetches them and one message delivers the sections (the host
  // touches no data), each section's failure landing honestly in the message.
  agent.ctx.effect(async () => {
    followupText(agent, await overviewFirstScreenText(ctx))
    return async () => undefined
  }, 'person-agent:overview-first-screen')
  const catalog = ctx.apps.catalog()
  const rows = ctx.workspaceRegistry.list()
    return (
      <>
        <h1>Person Agent · 个人工作台（人机桥概览）</h1>
        <p>应用目录 {catalog.length} 个应用；工作区 {rows.length} 个。</p>
        <h2>应用目录</h2>
        <ul>
          {catalog.map((record) => (
            <li key={record.definition.id}>{record.definition.name}（{record.definition.id} · {record.state}）</li>
          ))}
        </ul>
        <h2>Workspace List（工作区）</h2>
        <ul>
          {rows.map((workspace) => (
            <li key={workspace.id}>{workspace.title}（id: {workspace.id}；会话账目 {workspace.sessionIds.length}）</li>
          ))}
        </ul>
        <blockquote>
          Agent Preset List / Model Catalog / 待办任务三节随后以一条消息送达（每节失败各自如实标注）；
          选预设或模型时取消息行内 id，省略 presetId/provider/model 即用部署默认。
        </blockquote>
        <blockquote>
          要看某个工作区的会话明细，用本页挂载的 workspace_session_list 工具：workspaceId 取上面行内
          “id:” 之后的完整值（不是标题，也不是把标题改写成连字符形式）；标题只是展示名，注册表按 id 解析。
          Workspace List / Agent Preset List / Model Catalog 都来自部署注册表：选预设或模型时取行内 id，
          省略 presetId/provider/model 即用部署默认。apps 区与 tasks 区不提供下钻，只报快照；
          预设/模型/任务读取失败时正文如实标注原因。正文是打开时刻的首屏——此后变化以工具调用的结果为准。
        </blockquote>
      </>
    )
  }

  export const OverviewMeta: ComponentPageMeta = {
    name: 'overview',
    url: `${URL_PREFIX}/overview`,
    description: '个人工作台概览：看清部署的应用、工作区、预设与模型，处理待办任务，并可新建/派发/归档会话',
    // 十件工具都是写动作，如实声明写意图
    // / all ten tools are writes; declare the write intent honestly
    writes: true,
    // 无人值守契约（docs/unattended-page-contract.cn.md §5 行 3）：派发结算范本——
    // 反被动自查 + session_dispatch 派发 + never poll。
    // / The unattended contract (docs/unattended-page-contract.md §5 row 3): the
    // dispatch-settlement template — anti-passivity check, session_dispatch, never poll.
    unattended: {
      serves: '工作派发与个人会话/工作区编排类投递任务（反被动：连续查看即停手改派发）',
      level: 'L1',
      evidence: 'session_dispatch 的派发回执 + 结算看守送达的收尾输出（目标会话收尾时自动回到本会话）',
      escape: '结算看守到期结清（WATCH_DEFAULTS 上界）——回报不悬空；三节读取失败各自如实标注，不编造数字',
      budget: '派发后即返回不轮询；看守上界 = app.ts 的 WATCH_DEFAULTS',
    },
    instructions: '这是 Person Agent 的首页（个人工作台概览）。正文即真实状态：'
      + 'apps 区来自应用目录（正文直读），Workspace List 来自工作区注册表（正文直读，每行带工作区 id 与会话账目）。'
      + 'Agent Preset List、Model Catalog 与待办任务三节在打开后以一条消息送达（每行带 id）；'
      + '读取失败时消息会如实标注失败原因——如实告知用户，不要编造数字。'
      + '此后变化不经页面刷新，以你调用工具返回的结果为准。'
      + '本页挂载十个工具：workspace_session_list（查某工作区的会话明细，session id 从它的结果里查）、'
      + 'session_create（新建会话，省略 workspaceId 则继承当前会话的工作区）、'
      + 'session_rename（按 sessionId 改会话标题）、'
      + 'session_dispatch（把一段提示派给某个会话后立即返回，目标静止时其收尾输出会自动回到本会话）、'
      + 'session_archive / session_unarchive（归档/取消归档会话）、'
      + 'session_pin / session_unpin（置顶/取消置顶会话）、'
      + 'workspace_create（把已存在的目录登记为新工作区）、workspace_rename（按 id 改工作区标题）。'
      + '需要 workspaceId 的工具都取正文行内 “id:” 之后的完整值——不是标题，也不是标题的连字符形式；'
      + '标题只是展示名，注册表按 id 解析。session id 一律先用 workspace_session_list 查。'
      + '选预设或模型时用 Agent Preset List / Model Catalog 行内的 id；省略 presetId/provider/model 即用部署默认。'
      + 'apps 区与 tasks 区本页不提供下钻，只报快照。'
      + '停手自查（每次工具调用前）：这个会话是不是已经连续 3 步以上只在查看或分析'
      + '（读文件、搜索、读网页），而工作还没有派给任何会话？是就立刻停手：不再读文件、不再搜索、不写代码；'
      + '用 session_create 加 session_dispatch 把目标与验收标准派给一个会话，然后向用户汇报，不要轮询。'
      + '你唯一亲手做的是给人看的文字——那也要先加载 renhua 技能。',
    instanceTitle: () => '个人工作台',
  }

  // ---- 工作区浏览页（只读副页）---- Workspace browser page (a read-only secondary page) ----

  /**
   * 工作区浏览：注册表是同步内存读——工厂闭包直读，零状态。四个工具在组件体
   * 就地登记（设计律：工具只在页面存在）。
   * The workspace browser: the registry is a sync in-memory read through the
   * factory closure — zero state. The four tools register in place in the
   * component body (design law: a tool exists only inside a page).
   */
export const WorkspacesPage: PageFC = (_props, agent) => {
  const ctx = requireCtx()
  // renhua 随页挂载 / renhua rides the page
  agent.ctx.skills.register({ ...loadRenhuaSkill(), source: 'runtime' })
  for (const tool of takeWorkspaceTools()) agent.ctx.tools.register(tool)
  const rows = ctx.workspaceRegistry.list()
    return (
      <>
        <h1>Person Agent · 工作区浏览</h1>
        <p>共 {rows.length} 个工作区（标题与 id/会话账目数）。</p>
        <ul>
          {rows.map((workspace) => (
            <li key={workspace.id}>{workspace.title}（id: {workspace.id}；会话账目 {workspace.sessionIds.length}）</li>
          ))}
        </ul>
        <blockquote>
          要看某个工作区的会话明细，用 workspace_session_list 传 workspaceId——取行内 “id:” 之后的完整值
          （标题只是展示名，注册表按 id 解析）；建会话（session_create）或登记新工作区（workspace_create）
          时同理。该数据源不可用时如实说明。
        </blockquote>
      </>
    )
  }

  export const WorkspacesMeta: ComponentPageMeta = {
    name: 'workspaces',
    url: `${URL_PREFIX}/workspaces`,
    description: '工作区浏览：列出各工作区及其会话账目，并可在工作区内新建会话',
    // 本页登记的四个工具都是写动作，如实声明写意图
    // / all four registered tools are writes; declare the write intent honestly
    writes: true,
    // 无人值守契约（docs/unattended-page-contract.cn.md §5 行 4）。
    // / The unattended contract (docs/unattended-page-contract.md §5 row 4).
    unattended: {
      serves: '工作区盘点/建会话/登记目录类投递任务',
      level: 'L1',
      evidence: '一句话点名 workspace/session id（工具返回值）',
      escape: '数据源不可用时如实说明；登记/改名可逆（rename 可改回），不悬置',
    },
    instructions: '这是工作区浏览页。正文每行是一个工作区：标题（展示名）、id: 后的完整工作区 id、会话账目数。'
      + '本页挂载四个工具：workspace_session_list（查某工作区的会话明细，session id 从它的结果里查）、'
      + 'session_create（在该工作区新建会话，标题可选）、'
      + 'workspace_create（把已存在的目录登记为新工作区）、'
      + 'workspace_rename（按 id 改工作区标题）。'
      + '所有 workspaceId 都取行内 “id:” 之后的完整值——不是标题，也不是标题的连字符形式；'
      + '标题只是展示名，注册表按 id 解析。该数据源不可用时如实说明。',
    instanceTitle: () => '工作区浏览',
  }

