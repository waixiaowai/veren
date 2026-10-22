/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 应用的两个页面（自承载组件，RFC prompt-page-render §3.5）：模块级 PageFC +
 * 模块级 meta，经 `pages.register(component, meta)` 直接注册。同步服务面在正文
 * 里直接读（每帧最新）；异步服务面走 `ctx.page.effect` 拉取、`useState` 落地，
 * 重渲 diff 出 PAGE-PATCH。
 * The app's two pages as self-contained components (RFC prompt-page-render
 * §3.5): module-level PageFCs and metas registered directly. Synchronous
 * service faces are read straight in the body (fresh every frame); the
 * asynchronous face is fetched in `ctx.page.effect` and lands in `useState`,
 * re-rendering into a PAGE-PATCH.
 *
 * 工具两张脸的分工：无状态工具全部走 `meta.tools`（静态声明，暂存预挂即终态）；
 * session_dispatch 是唯一的动态脸（`ctx.page.tool`）——它携带随页面视图创建/
 * 销毁的结算看守。页面级 skill（renhua）随 meta.skills 声明，由 app-host 挂进
 * 会话 agent 作用域。§3.9 承诺对齐由"说明点名 = 真实挂载"守住（测试锁定）。
 * The two tool faces divide by state: every stateless tool rides `meta.tools`
 * (declared statically, final from the staged pre-mount on); session_dispatch
 * is the one dynamic face (`ctx.page.tool`) — it carries the settlement watch
 * created and disposed with the page view. The page-scope skill (renhua) is
 * declared in meta.skills and mounted by app-host into the session's agent
 * scope. §3.9 promise alignment is kept by "named in the instructions = really
 * mounted" (locked by tests).
 * @module @veren/person-agent-app
 */
import { useState } from '@veren/prompt-core'
import type { ComponentPageMeta, PageFC } from '@veren/prompt-page'
// 类型-only import：拉取 apps / workspaceRegistry / taskCenter 的 Context 声明合并，
// 正文里的 `ctx.apps` / `ctx.workspaceRegistry` / `ctx.taskCenter` 由此获得类型。
// Type-only imports: pull the apps / workspaceRegistry / taskCenter merging so
// `ctx.apps` / `ctx.workspaceRegistry` / `ctx.taskCenter` are typed in the body.
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@veren/app-registry'
import type {} from '@veren/task-center'
// 动作工具：复用兄弟工具包的构建器（与目录、宿主注册的是同一份实现）。
// session_dispatch 是唯一的动态脸——它携带随页面视图创建/销毁的结算看守。
// Action tools: reuse the sibling tool packages' builders (the very same
// implementations the catalog and the host register). session_dispatch is the
// one dynamic face — it carries the settlement watch created and disposed with
// the page view.
import { buildSessionDispatchDefinition, createSettlementWatch } from '@veren/person-agent-tool-session'
// 部署事实读取：预设名单与模型目录。facts.ts 只读数、出结构化事实；标点与
// 行排版由下方正文 tsx 渲染。工作区仍由正文直读注册表。
// Deployment-fact reads: the preset roster and model catalog. facts.ts only
// reads and returns structured facts; punctuation and line layout are rendered
// by the tsx body below. Workspaces stay a direct registry read in the body.
import { errorMessage, readAgentPresets, readModelCatalogGroups } from './facts.ts'
import type { AgentPresetView, ModelCatalogGroupView } from './facts.ts'
// 页面级 skill：renhua（写给人看的文字前先加载）随两页声明，app-host 挂进
// 会话 agent 作用域。结算看守的默认上限与应用目录同源（app.ts）。
// The page-scope skill: renhua (load before writing anything a human reads),
// declared on both pages, mounted by app-host into the session's agent scope.
// The settlement watch's default bounds come from the same source as the
// catalog's (app.ts).
import { WATCH_DEFAULTS } from './app.ts'
import { loadRenhuaSkill } from './skills.ts'

/** 应用内 URL 前缀 / the app-scoped url prefix */
const URL_PREFIX = '/apps/person-agent'

// ---- 概览页（home 档 / entry）---- Overview page (the home archetype / entry) ----

/**
 * 个人工作台概览：应用目录与工作区是同步内存读——正文直接调，首帧即真实数据；
 * 预设名单、模型目录与任务中心是异步读——`ctx.page.effect` 拉取，读取失败如实
 * 渲染原因，绝不编造数字。三块名单（Workspace List / Agent Preset List /
 * Model Catalog）都在正文里，模型从正文取 id，不依赖任何隐藏的 pre-step 注入。
 * The personal workbench overview: catalog and workspaces are sync in-memory
 * reads called straight in the body — the first frame already carries real
 * data; the preset roster, model catalog and task center are async reads fetched
 * in `ctx.page.effect`, with a failed read rendered honestly — never faked. All
 * three lists (Workspace List / Agent Preset List / Model Catalog) live in the
 * body, so the model takes ids from the page, never from a hidden pre-step.
 */
export const OverviewPage: PageFC = (_props, ctx) => {
  const apps = ctx.apps
  const workspaces = ctx.workspaceRegistry
  // 异步面：null = 读取中 / the async face: null = still reading
  const [openTasks, setOpenTasks] = useState<Awaited<ReturnType<Context['taskCenter']['list']>> | null>(null)
  const [taskError, setTaskError] = useState<string | null>(null)
  ctx.page.effect(() => {
    void ctx.taskCenter.list({ status: 'open' }).then(setOpenTasks, (error: unknown) => {
      setTaskError(error instanceof Error ? error.message : String(error))
    })
  })
  // 预设名单与模型目录：异步读部署注册表；读取失败如实渲染原因，绝不编造。
  // 页面正文只在组件重渲时更新，变化由 app-host 的 PAGE-PATCH 通道带走。
  // The preset roster and model catalog: async reads of the deployment
  // registries; failures render their reason honestly, never invented data.
  // The body updates when the component re-renders; app-host's PAGE-PATCH
  // carries the change.
  const [presets, setPresets] = useState<AgentPresetView[] | null>(null)
  const [presetError, setPresetError] = useState<string | null>(null)
  const [modelGroups, setModelGroups] = useState<ModelCatalogGroupView[] | null>(null)
  const [modelError, setModelError] = useState<string | null>(null)
  ctx.page.effect(() => {
    let cancelled = false
    void readAgentPresets(ctx).then(
      (views) => { if (!cancelled) setPresets(views) },
      (error: unknown) => { if (!cancelled) setPresetError(errorMessage(error)) },
    )
    return () => { cancelled = true }
  })
  ctx.page.effect(() => {
    let cancelled = false
    void readModelCatalogGroups(ctx).then(
      (groups) => { if (!cancelled) setModelGroups(groups) },
      (error: unknown) => { if (!cancelled) setModelError(errorMessage(error)) },
    )
    return () => { cancelled = true }
  })
  // 唯一的动态工具（RFC §5.4 动态面）：session_dispatch 连同本页自己的结算看守
  // ——看守随 effect 清理结清（agent 销毁或视图退订），派给已废弃会话的回报
  // 不会悬空。登记即承诺：instructions 点名 session_dispatch。
  // The one dynamic tool (RFC §5.4's dynamic face): session_dispatch together
  // with this page's own settlement watch — the watch settles when the effect
  // cleanup runs (agent disposal or view unsubscribe), so a report addressed to
  // a deprecated session never dangles. Registration is the promise:
  // instructions name session_dispatch.
  ctx.page.effect(() => {
    const watch = createSettlementWatch(ctx, WATCH_DEFAULTS)
    ctx.page.tool(buildSessionDispatchDefinition(ctx, watch))
    return () => { watch.dispose() }
  })
  const catalog = apps.catalog()
  const rows = workspaces.list()
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
      {presetError !== null
        ? <p>预设名单读取失败：{presetError}——如实告知用户，不要编造。</p>
        : presets === null
          ? <p>读取中…</p>
          : presets.length === 0
            ? <p>（无可用预设）</p>
            : <ul>
                {presets.map((preset) => (
                  <li key={preset.id}>
                    {preset.name}({preset.id})
                    {preset.description ? `:${preset.description}` : null}
                    {preset.broken ? `（不可用：${preset.broken}）` : null}
                  </li>
                ))}
              </ul>}
      <h2>Model Catalog（模型目录）</h2>
      {modelError !== null
        ? <p>模型目录读取失败：{modelError}——如实告知用户，不要编造。</p>
        : modelGroups === null
          ? <p>读取中…</p>
          : modelGroups.length === 0
            ? <p>（无可用模型）</p>
            : <ul>
                {modelGroups.map((group) => (
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
      {taskError !== null
        ? <p>任务中心读取失败：{taskError}——如实告知用户，不要编造数字。</p>
        : <p>{openTasks === null ? '读取中…' : `open 任务 ${openTasks.length} 条（live 自任务中心）`}</p>}
      <blockquote>
        要看某个工作区的会话明细，用本页挂载的 workspace_session_list 工具：workspaceId 取上面行内
        “id:” 之后的完整值（不是标题，也不是把标题改写成连字符形式）；标题只是展示名，注册表按 id 解析。
        Workspace List / Agent Preset List / Model Catalog 都来自部署注册表：选预设或模型时取行内 id，
        省略 presetId/provider/model 即用部署默认。apps 区与 tasks 区不提供下钻，只报快照；
        预设/模型/任务读取失败时正文如实标注原因。
      </blockquote>
    </>
  )
}

/** 本页挂载的无状态工具（meta.tools 静态脸）/ the stateless tools mounted by this page (the static meta.tools face) */
const OVERVIEW_TOOLS = [
  'workspace_session_list',
  'session_create',
  'session_rename',
  'session_archive',
  'session_unarchive',
  'session_pin',
  'session_unpin',
  'workspace_create',
  'workspace_rename',
] as const

export const OverviewMeta: ComponentPageMeta = {
  name: 'overview',
  url: `${URL_PREFIX}/overview`,
  description: '个人工作台概览：看清部署的应用、工作区、预设与模型，处理待办任务，并可新建/派发/归档会话',
  // 静态脸：九个无状态工具；动态脸（session_dispatch）由组件注册
  // / the static face: the nine stateless tools; the dynamic face (session_dispatch) is registered by the component
  tools: OVERVIEW_TOOLS,
  // renhua 随页挂载：写给人看的文字之前先加载（应用说明的分内线）
  // / renhua rides the page: load it before writing anything a human reads (the app note's carve-out line)
  skills: [loadRenhuaSkill()],
  // 静态九工具 + 动态派活都是写动作，如实声明写意图
  // / the nine static tools plus dynamic dispatch are all writes; declare the intent honestly
  writes: true,
  instructions: '这是 Person Agent 的首页（个人工作台概览）。正文即真实状态：'
    + 'apps 区来自应用目录（正文直读），Workspace List 来自工作区注册表（正文直读，每行带工作区 id 与会话账目），'
    + 'Agent Preset List 与 Model Catalog 来自部署的预设/模型注册表（挂载后异步刷新，每行带 id），'
    + 'tasks 区来自任务中心的 open 任务计数（挂载后异步刷新）。'
    + '预设/模型/任务读取失败时正文会如实标注失败原因——如实告知用户，不要编造数字。'
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
 * 工作区浏览：注册表是同步内存读——正文直接读，零状态零 effect。四个工具全部
 * 走静态脸（meta.tools），本组件没有动态注册。
 * The workspace browser: the registry is a sync in-memory read straight in the
 * body — zero state, zero effect. All four tools ride the static face
 * (meta.tools); this component registers nothing dynamically.
 */
export const WorkspacesPage: PageFC = (_props, ctx) => {
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
  tools: ['workspace_session_list', 'session_create', 'workspace_create', 'workspace_rename'],
  skills: [loadRenhuaSkill()],
  // 本页静态挂了写工具（session_create / workspace_create / workspace_rename），如实声明写意图
  // / this page statically mounts write tools; declare the write intent honestly
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
