/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 概览页（home 档 / entry）：个人工作台。同步面（应用目录、工作区）正文直读；
 * 异步三节（任务/预设/模型）由组件体自己的 effect 取齐、一条 followup 消息送达。
 * 十件工具在体登记：九件无状态就地登记，session_dispatch 连同本页自己的结算
 * 看守经 agent.ctx.effect 登记——看守随 agent 销毁结清。
 * The overview page (the home archetype / entry): the personal workbench. Sync
 * faces (the app catalog, workspaces) read straight in the body; the three async
 * sections (tasks/presets/models) are fetched by the body's own effect and
 * delivered as one followup message. Ten tools register in the body: nine
 * stateless ones in place, and session_dispatch together with this page's own
 * settlement watch via agent.ctx.effect - the watch settles at agent disposal.
 * @module @veren/person-agent-app
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ElementInput } from '@veren/prompt-core'
import type { ComponentPageMeta, PageFC } from '@veren/prompt-page'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@veren/app-registry'
import { buildSessionDispatchDefinition, createSettlementWatch } from '@veren/person-agent-tool-session'
import { WATCH_DEFAULTS } from './app.ts'
import { requireCtx } from './page-context.ts'
import { followupText, URL_PREFIX } from './page-shared.ts'
import { named, takeOverviewTools } from './page-tools.ts'
import { overviewFirstScreenText } from './overview-sections.ts'
import { loadRenhuaSkill } from './skills.ts'

/** 应用目录条目：投影宿主 apps 服务面，不手写影子副本。The app-catalog entry: projected from the host apps service face, not a shadow copy. */
type CatalogEntry = ReturnType<Context['apps']['catalog']>[number]

/** 工作区注册表条目：投影宿主 workspaceRegistry 服务面。The workspace-registry entry: projected from the host workspaceRegistry service face. */
type WorkspaceRow = ReturnType<Context['workspaceRegistry']['list']>[number]

/**
 * 组件体运行时登记（跑一次，安全）：renhua 随页挂载；无状态九件就地登记；
 * session_dispatch 连同本页自己的结算看守经 agent.ctx.effect 登记——看守随
 * agent 销毁结清，派给已废弃会话的回报不会悬空；首屏三路异步读也是组件体
 * 自己的 lifecycle——effect 取齐后以一条消息送达（宿主不经手取数），每节失败
 * 在消息里如实落地。
 * The body's runtime registrations (run once, safe): renhua rides the page;
 * the nine stateless tools register in place; session_dispatch together with
 * this page's own settlement watch rides an agent.ctx.effect - the watch
 * settles at agent disposal, so a report addressed to a deprecated session
 * never dangles; the first-screen async reads are the body's own lifecycle
 * too - one effect fetches them and one message delivers the sections (the
 * host touches no data), each section's failure landing honestly in the
 * message.
 */
function registerOverviewRuntime(agent: Agent, ctx: Context): void {
  // renhua 随页挂载：单会话 skill 由组件体直登（与工具同机制，随 agent fiber 生灭）。
  // renhua rides the page: the single-session skill registers in the body (the
  // same mechanism as the tools, living and dying with the agent fiber).
  agent.ctx.skills.register({ ...loadRenhuaSkill(), source: 'runtime' })
  // 登记即承诺：instructions 点名 session_dispatch。
  // Registration is the promise: instructions name session_dispatch.
  for (const tool of takeOverviewTools()) agent.ctx.tools.register(tool)
  agent.ctx.effect(() => {
    const watch = createSettlementWatch(ctx, WATCH_DEFAULTS)
    agent.ctx.tools.register(named(buildSessionDispatchDefinition(ctx, watch)))
    return () => { watch.dispose() }
  }, 'person-agent:dispatch-watch')
  agent.ctx.effect(async () => {
    followupText(agent, await overviewFirstScreenText(ctx))
    return async () => undefined
  }, 'person-agent:overview-first-screen')
}

/** 应用目录区：正文直读的应用清单。The catalog section: the app list read straight in the body. */
function CatalogSection(props: { readonly catalog: readonly CatalogEntry[] }): ElementInput {
  return (
    <>
      <h2>应用目录</h2>
      <ul>
        {props.catalog.map((record) => (
          <li key={record.definition.id}>{record.definition.name}（{record.definition.id} · {record.state}）</li>
        ))}
      </ul>
    </>
  )
}

/** 工作区区：正文直读的工作区清单。The workspace section: the workspace list read straight in the body. */
function WorkspaceSection(props: { readonly rows: readonly WorkspaceRow[] }): ElementInput {
  return (
    <>
      <h2>Workspace List（工作区）</h2>
      <ul>
        {props.rows.map((workspace) => (
          <li key={workspace.id}>{workspace.title}（id: {workspace.id}；会话账目 {workspace.sessionIds.length}）</li>
        ))}
      </ul>
    </>
  )
}

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
  registerOverviewRuntime(agent, ctx)
  const catalog = ctx.apps.catalog()
  const rows = ctx.workspaceRegistry.list()
  return (
    <>
      <h1>Person Agent · 个人工作台（人机桥概览）</h1>
      <p>应用目录 {catalog.length} 个应用；工作区 {rows.length} 个。</p>
      <CatalogSection catalog={catalog} />
      <WorkspaceSection rows={rows} />
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
