/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 应用的两个页面（一次性渲染形态）：`createPersonAgentPages(ctx)` 以本插件的
 * ctx 为纯参数产出 PageFC + meta——同步服务面（应用目录、工作区注册表）由工厂
 * 闭包直读；异步面（任务中心、预设名单、模型目录）全部进 load（一次性渲染
 * 没有"渲染后再取数"的第二次入口），失败态随快照如实渲染。
 * The app's two pages in the one-shot form: `createPersonAgentPages(ctx)` takes
 * this plugin's ctx as the pure parameter and yields PageFCs + metas — sync
 * service faces (the app catalog, the workspace registry) are read straight
 * through the factory closure; the async faces (task center, preset roster,
 * model catalog) all live in load (a one-shot render has no second "fetch after
 * render" entry), with failures rendered honestly from the snapshot.
 *
 * 设计律：**工具只在页面存在**。组件体在页面会话的真实 Agent 上执行恰好一次，
 * 工具由体直接 `agent.ctx.tools.register` 登记（全名 `person_agent__<本地名>`，
 * 随 agent fiber 生灭）；session_dispatch 携带结算看守——它经
 * `agent.ctx.effect` 登记，看守随 agent 销毁结清，派给已废弃会话的回报不会悬空。
 * 页面级 skill（renhua）随 meta.skills 声明，由 app-host 挂进会话 agent 作用域。
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
import { useSnapshot } from '@veren/prompt-page'
import type { ComponentPageMeta, PageFC, PageJsonValue } from '@veren/prompt-page'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-workspace'
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
// 页面级 skill：renhua（写给人看的文字前先加载）随两页声明，app-host 挂进
// 会话 agent 作用域。结算看守的默认上限单一来源（app.ts）。
// The page-scope skill: renhua (load before writing anything a human reads),
// declared on both pages, mounted by app-host into the session's agent scope.
// The settlement watch's default bounds have one source (app.ts).
import { WATCH_DEFAULTS } from './app.ts'
import { loadRenhuaSkill } from './skills.ts'

/** 应用内 URL 前缀 / the app-scoped url prefix */
const URL_PREFIX = '/apps/person-agent'

/** 工具对外名：`person_agent__<本地名>`（§3.4.3）/ the external tool name */
const externalName = (localName: string): string => `person_agent__${localName}`

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
  const catalog = ctx.apps.catalog()
  const rows = ctx.workspaceRegistry.list()
  const snap = useSnapshot<OverviewFirstScreen>()
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
        <h2>Agent Preset List（预设名单）</h2>
        {snap?.presets.error !== null && snap?.presets.error !== undefined
          ? <p>预设名单读取失败：{snap.presets.error}——如实告知用户，不要编造。</p>
          : snap === undefined
            ? <p>读取中…</p>
            : snap.presets.presets.length === 0
              ? <p>（无可用预设）</p>
              : <ul>
                  {snap.presets.presets.map((preset) => (
                    <li key={preset.id}>
                      {preset.name}({preset.id})
                      {preset.description ? `:${preset.description}` : null}
                      {preset.broken ? `（不可用：${preset.broken}）` : null}
                    </li>
                  ))}
                </ul>}
        <h2>Model Catalog（模型目录）</h2>
        {snap?.models.error !== null && snap?.models.error !== undefined
          ? <p>模型目录读取失败：{snap.models.error}——如实告知用户，不要编造。</p>
          : snap === undefined
            ? <p>读取中…</p>
            : snap.models.groups.length === 0
              ? <p>（无可用模型）</p>
              : <ul>
                  {snap.models.groups.map((group) => (
                    <li key={group.id}>
                      {group.name}({group.id}){group.error === undefined ? null : `: 读取失败：${group.error}`}
                      {group.models.length > 0
                        ? <ul>
                            {group.models.map((model) => (
                              <li key={model.id}>
                                {model.name}({model.id}): input {model.inputModalities.includes('image') ? 'text+image' : 'text'}
                                {' · '}
                                {model.contextWindow === undefined ? 'context unknown' : `context ${model.contextWindow} tokens`}
                                {model.hint === '' ? null : ` · use when: ${model.hint}`}
                              </li>
                            ))}
                          </ul>
                        : null}
                    </li>
                  ))}
                </ul>}
        <h2>待办任务</h2>
        {snap?.tasks.error !== null && snap?.tasks.error !== undefined
          ? <p>任务中心读取失败：{snap.tasks.error}——如实告知用户，不要编造数字。</p>
          : <p>{snap === undefined ? '读取中…' : `open 任务 ${snap.tasks.openCount ?? 0} 条（live 自任务中心）`}</p>}
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
    // renhua 随页挂载：写给人看的文字之前先加载（应用说明的分内线）。
    // renhua rides the page: load it before writing anything a human reads (the
    // app note's carve-out line).
    skills: [loadRenhuaSkill()],
    // 十件工具都是写动作，如实声明写意图
    // / all ten tools are writes; declare the intent honestly
    writes: true,
    instructions: '这是 Person Agent 的首页（个人工作台概览）。正文即真实状态：'
      + 'apps 区来自应用目录（正文直读），Workspace List 来自工作区注册表（正文直读，每行带工作区 id 与会话账目），'
      + 'Agent Preset List 与 Model Catalog 来自部署的预设/模型注册表（首屏快照，每行带 id），'
      + 'tasks 区来自任务中心的 open 任务计数（首屏快照）。'
      + '预设/模型/任务读取失败时正文会如实标注失败原因——如实告知用户，不要编造数字。'
      + '正文是打开时刻的首屏——此后变化不经页面刷新，以你调用工具返回的结果为准。'
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
    // 三路异步读在 load 里一次取齐；每节独立 try/catch——失败态随快照进正文。
    // The three async reads settle together in load; each section catches its
    // own failures — failure states ride the snapshot into the body.
    load: async (_params, _env): Promise<PageJsonValue> => {
      const appCtx = requireCtx()
      const tasks = await appCtx.taskCenter.list({ status: 'open' }).then(
        (openTasks) => ({ error: null, openCount: openTasks.length }) satisfies TasksSection,
        (error: unknown) => ({ error: errorMessage(error), openCount: null }) satisfies TasksSection,
      )
      const presets = await readAgentPresets(appCtx).then(
        (views) => ({ error: null, presets: views }) satisfies PresetsSection,
        (error: unknown) => ({ error: errorMessage(error), presets: [] }) satisfies PresetsSection,
      )
      const models = await readModelCatalogGroups(appCtx).then(
        (groups) => ({ error: null, groups }) satisfies ModelsSection,
        (error: unknown) => ({ error: errorMessage(error), groups: [] }) satisfies ModelsSection,
      )
      return { tasks, presets, models } satisfies OverviewFirstScreen as unknown as PageJsonValue
    },
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
    // renhua 随页挂载 / renhua rides the page
    skills: [loadRenhuaSkill()],
    // 本页登记的四个工具都是写动作，如实声明写意图
    // / all four registered tools are writes; declare the write intent honestly
    writes: true,
    instructions: '这是工作区浏览页。正文每行是一个工作区：标题（展示名）、id: 后的完整工作区 id、会话账目数。'
      + '本页挂载四个工具：workspace_session_list（查某工作区的会话明细，session id 从它的结果里查）、'
      + 'session_create（在该工作区新建会话，标题可选）、'
      + 'workspace_create（把已存在的目录登记为新工作区）、'
      + 'workspace_rename（按 id 改工作区标题）。'
      + '所有 workspaceId 都取行内 “id:” 之后的完整值——不是标题，也不是标题的连字符形式；'
      + '标题只是展示名，注册表按 id 解析。该数据源不可用时如实说明。',
    instanceTitle: () => '工作区浏览',
  }

