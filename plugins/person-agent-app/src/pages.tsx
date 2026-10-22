/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 应用的两个页面（自承载组件，RFC prompt-page-render §3.5）：模块级 PageFC +
 * 模块级 meta，经 `pages.register(component, meta)` 直接注册——没有工厂、没有
 * 闭包注入、没有快照契约。同步服务面在正文里直接读（每帧最新，零状态零
 * effect）；异步服务面走 `ctx.page.effect` 拉取、`useState` 落地，重渲 diff 出
 * PAGE-PATCH。外部权威 store 的页面才走 `meta.store` + `useSnapshot`
 * （如 task-workbench）。
 * The app's two pages as self-contained components (RFC prompt-page-render
 * §3.5): module-level PageFCs and metas registered directly via
 * `pages.register(component, meta)` — no factory, no closure injection, no
 * snapshot contract. Synchronous service faces are read straight in the body
 * (fresh every frame, zero state, zero effect); the asynchronous face is
 * fetched in `ctx.page.effect` and lands in `useState`, re-rendering into a
 * PAGE-PATCH. Pages backed by an external authoritative store use
 * `meta.store` + `useSnapshot` instead (task-workbench).
 *
 * §3.10.1 档位：两页都声明写意图（`writes: true`）——入口是 home、副页是
 * action。工具两张脸都用上：`meta.tools` 声明目录能力（workspace_session_list，
 * 静态面供市场/权限/发现），`ctx.page.tool` 注册会话实例（session_create /
 * session_rename，动态面供本会话的 agent 真正动作）。构造上规则 1 成立（map 由
 * 注册表推导，列全兄弟页）、规则 3 无从触发；§3.9 承诺对齐由"说明点名 = 真实
 * 挂载"守住。
 * §3.10.1 archetypes: both pages declare write intent (`writes: true`) — the
 * entry is home, the sibling is action. Both tool faces are used: `meta.tools`
 * declares catalog capability (workspace_session_list — the static face for the
 * market / permissions / discovery), and `ctx.page.tool` registers session
 * instances (session_create / session_rename — the dynamic face that lets this
 * session's agent really act). Rule 1 holds by construction (the map is
 * registry-derived, listing all sibling pages) and rule 3 cannot trigger; §3.9
 * promise alignment is kept by "named in the instructions = really mounted".
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
// 动作工具：复用兄弟工具包的构建器（与目录、宿主注册的是同一份实现），
// 在页面会话作用域内动态注册——注册即作用域，随会话销毁自动摘除。
// Action tools: reuse the sibling tool packages' builders (the very same
// implementations the catalog and the host register) and register them
// dynamically in the page session's scope — registration is the scope, removed
// with the session.
import { buildSessionCreateDefinition, buildSessionRenameDefinition } from '@veren/person-agent-tool-session'
// 部署事实读取：预设名单与模型目录。facts.ts 只读数、出结构化事实；标点与
// 行排版由下方正文 tsx 渲染。工作区仍由正文直读注册表。
// Deployment-fact reads: the preset roster and model catalog. facts.ts only
// reads and returns structured facts; punctuation and line layout are rendered
// by the tsx body below. Workspaces stay a direct registry read in the body.
import { errorMessage, readAgentPresets, readModelCatalogGroups } from './facts.ts'
import type { AgentPresetView, ModelCatalogGroupView } from './facts.ts'

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
  // 动作工具（RFC §5.4 动态面）：注册进本会话作用域——agent 在工作台里能真的建会话、
  // 改标题，而不是只有只读查询。登记即承诺：instructions 同步点名这两个工具。
  // Action tools (RFC §5.4's dynamic face): registered into this session's scope —
  // the agent can really create sessions and rename them from the workbench, not
  // just read. Registration is the promise: instructions name both tools.
  ctx.page.effect(() => {
    ctx.page.tool(buildSessionCreateDefinition(ctx))
    ctx.page.tool(buildSessionRenameDefinition(ctx))
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

export const OverviewMeta: ComponentPageMeta = {
  name: 'overview',
  url: `${URL_PREFIX}/overview`,
  description: '个人工作台概览：看清部署的应用、工作区、预设与模型，处理待办任务，并可新建/重命名会话',
  // 挂本页承诺的现查读工具：说明里点名"看会话明细用它"，它就必须真的在页面上
  // / mount the read tool the page promises: naming it in the instructions requires it to really be mounted
  tools: ['workspace_session_list'],
  // 本页注册了动作工具（session_create / session_rename），如实声明写意图
  // / this page registers action tools (session_create / session_rename); declare the write intent honestly
  writes: true,
  instructions: '这是 Person Agent 的首页（个人工作台概览）。正文即真实状态：'
    + 'apps 区来自应用目录（正文直读），Workspace List 来自工作区注册表（正文直读，每行带工作区 id 与会话账目），'
    + 'Agent Preset List 与 Model Catalog 来自部署的预设/模型注册表（挂载后异步刷新，每行带 id），'
    + 'tasks 区来自任务中心的 open 任务计数（挂载后异步刷新）。'
    + '预设/模型/任务读取失败时正文会如实标注失败原因——如实告知用户，不要编造数字。'
    + '本页挂载三个工具：workspace_session_list（查某工作区的会话明细）、'
    + 'session_create（新建会话，省略 workspaceId 则继承当前会话的工作区）、'
    + 'session_rename（按 sessionId 改会话标题，sessionId 先用 workspace_session_list 查）。'
    + '两个需要 workspaceId 的工具都取正文行内 “id:” 之后的完整值——不是标题，也不是标题的连字符形式；'
    + '标题只是展示名，注册表按 id 解析。'
    + '选预设或模型时用 Agent Preset List / Model Catalog 行内的 id；省略 presetId/provider/model 即用部署默认。'
    + 'apps 区与 tasks 区本页不提供下钻，只报快照。',
  instanceTitle: () => '个人工作台',
}

// ---- 工作区浏览页（只读副页）---- Workspace browser page (a read-only secondary page) ----

/**
 * 工作区浏览：注册表是同步内存读——正文直接读，零状态零 effect，只读。
 * The workspace browser: the registry is a sync in-memory read straight in the
 * body — zero state, zero effect, read-only.
 */
export const WorkspacesPage: PageFC = (_props, ctx) => {
  // 动作工具：本页列出工作区，建会话是这块正文最自然的动作（workspaceId 取行内 id）。
  // Action tool: this page lists workspaces, so creating a session inside one is
  // the body's natural action (workspaceId comes from a row).
  ctx.page.effect(() => { ctx.page.tool(buildSessionCreateDefinition(ctx)) })
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
        （标题只是展示名，注册表按 id 解析）；建会话时 workspaceId 同理。该数据源不可用时如实说明。
      </blockquote>
    </>
  )
}

export const WorkspacesMeta: ComponentPageMeta = {
  name: 'workspaces',
  url: `${URL_PREFIX}/workspaces`,
  description: '工作区浏览：列出各工作区及其会话账目，并可在工作区内新建会话',
  tools: ['workspace_session_list'],
  // 本页注册了动作工具（session_create），如实声明写意图
  // / this page registers an action tool (session_create); declare the write intent honestly
  writes: true,
  instructions: '这是工作区浏览页。正文每行是一个工作区：标题（展示名）、id: 后的完整工作区 id、会话账目数。'
    + '本页挂载两个工具：workspace_session_list（查某工作区的会话明细）、'
    + 'session_create（在该工作区新建会话，标题可选）。'
    + '两个工具的 workspaceId 都取行内 “id:” 之后的完整值——不是标题，也不是标题的连字符形式；'
    + '标题只是展示名，注册表按 id 解析。该数据源不可用时如实说明。',
  instanceTitle: () => '工作区浏览',
}
