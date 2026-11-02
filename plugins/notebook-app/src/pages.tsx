/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 记事本的两个页面（一次性渲染形态，模块级组件）：`export const XxxPage: PageFC`
 * 直接导出，不做工厂封装。组件体在页面会话的真实 Agent 上执行恰好一次，产物
 * 成型为 PAGE 块正文；工具由组件体直接 `agent.ctx.tools.register` 登记（全名
 * `notebook__<本地名>`，随 agent fiber 生灭）。
 * 首屏读取是组件体自己的生命周期：归属解析自会话头 `agentPreset`（与工具取
 * 调用者同源——身份走会话头，不进 URL）；异步读经 `agent.ctx.effect` 发起，
 * 读到的首屏（含失败态）经 `agent.followup` 以新消息进上下文。正文是打开时刻
 * 的静态框，绝不留白。首屏文本的形状与渲染在 `first-screen.ts`；本文件只留
 * 页面本体与元数据。
 * The notebook's two pages in the one-shot form as MODULE-LEVEL components — no
 * factory wrapper. The body runs exactly once on the page session's real Agent
 * and its output becomes the PAGE block body; tools register via
 * `agent.ctx.tools.register` (full names `notebook__<local>`, living and dying
 * with the agent fiber).
 * The first-screen read is the body's own lifecycle: the owner resolves from
 * the session header's `agentPreset` (the same face the tools read their caller
 * from — identity rides the session header, never the url); the async read
 * starts via `agent.ctx.effect` and its result (failure states included) rides
 * `agent.followup` as a new message. The body itself is the static frame at
 * open time, never a blank. The first-screen shapes and rendering live in
 * `first-screen.ts`; this file keeps only the page bodies and their metadata.
 * @module @veren/notebook-app/pages
 */
import type { ComponentPageMeta, PageFC } from '@veren/prompt-page'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { listFirstScreenText, noteFirstScreenText, requireServices } from './first-screen.ts'

/** 应用内 URL 前缀 / the app-scoped url prefix */
const URL_PREFIX = '/apps/notebook'

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

/** 按本地名取全名工具定义 / look up a full-named tool definition by local name */
function toolOf(localName: string): ToolDefinition {
  const found = requireServices().tools.find((tool) => tool.name === `notebook__${localName}`)
  if (found === undefined) throw new Error(`[notebook-app] tool notebook__${localName} is not defined`)
  return found
}

/** 页面作用域完成回报面登记（两页同挂；§6 投递闭环的最后一环）/ register the page-scoped completion face (both pages; the delivery loop's last link, §6) */
function registerPageTaskFace(agent: Parameters<PageFC>[1]): void {
  for (const tool of requireServices().taskFace()) agent.ctx.tools.register(tool)
}

// ---- 列表页（首页 home / entry，卡片列表）---- List page (the home page / entry, the card list) ----

export const ListPage: PageFC = (_props, agent) => {
  agent.ctx.tools.register(toolOf('list_notes'))
  agent.ctx.tools.register(toolOf('find_cards'))
  agent.ctx.tools.register(toolOf('write_note'))
  agent.ctx.tools.register(toolOf('capture_note'))
  agent.ctx.tools.register(toolOf('list_hubs'))
  agent.ctx.tools.register(toolOf('box_stats'))
  // 投递回报面随页挂载 / the delivery-report face rides the page
  registerPageTaskFace(agent)
  // 首屏读取：组件体自己的 lifecycle（effect 发起、followup 送达——宿主不经手取数）
  // / the first-screen read: the body's own lifecycle (an effect starts it, a followup delivers it — the host touches no data)
  agent.ctx.effect(async () => {
    followupText(agent, await listFirstScreenText(agent))
    return async () => undefined
  }, 'notebook:list-first-screen')
  // 正文是打开时刻的静态框：数据随后以消息送达，不留白。
  // / the body is the static frame at open time: data arrives as a message, never a blank.
  return (
    <blockquote>卡片列表与盒的入口随后以消息送达；也可直接用 list_notes、find_cards 与 list_hubs 取。</blockquote>
  )
}

export const ListMeta: ComponentPageMeta = {
  name: 'list',
  url: `${URL_PREFIX}/list`,
  description: '记事本列表页：浏览当前预设的全部卡片与盒的入口（枢纽），并可新建卡片',
  // 本页登记了写工具（write_note），如实声明写意图
  // / this page registers a write tool (write_note); declare the intent honestly
  writes: true,
  unattended: {
    serves: '卡片新建与列表盘点类投递任务（归属 = 会话头预设）',
    level: 'L1',
    evidence: '一句话点名新卡片的 id 与标题（write_note 返回值）；投递任务以 task_complete 的 summary+artifacts 收口',
    escape: '归属未知、存储失败或写入被拒（title-conflict/link-unresolved）时如实回报并停在该任务，不悬置；列表为空就如实说空；投递任务做不完用 task_fail 带稳定码',
  },
  instructions: '这是记事本的首页（卡片列表）。首屏在打开后以一条消息送达：owner（归属预设）、'
    + 'notes（该预设的卡片，id/title/excerpt/updatedAt/kind）、hubs（被链接最多的卡片——盒的入口）、'
    + '进料口（闪念队列，过期者优先）与待加工区、谜面；'
    + '归属未知或读取失败会在消息里如实说明——不要编造卡片。'
    + '此后变化以你调用工具返回的结果为准。'
    + '用 list_notes 刷新列表（可用 kind 参数只看 fleeting/permanent/project 一类），用 find_cards 按标题片段找卡（写前查重也用它），'
    + '用 list_hubs 取入口，用 box_stats 看盒的呼吸读数（类别构成/链接密度/进料深度/7 天速率）。'
    + '有原始想法或阅读摘录用 capture_note 捕获闪念（快、糙：标题可省、链接可悬空）；'
    + '想清楚了一卡一想法用 write_note 写永久卡（标题=完整短语=链接地址，'
    + '正文可用 [[标题]] 链接已有卡片——闪念不是合法目标，目标不存在会被 link-unresolved 拒绝并给出相近标题）；'
    + '处理进料口：闪念只有两个出路——炼成永久卡，或把已蒸掉想法的扔掉；两个动作都在卡片详情页完成（见 map），未加工就扔等于丢掉想法。'
    + '新建后报出卡片 id 与标题（一句话证据回报），列表为空时如实说明。'
    + '投递到本页的任务另有三件页面作用域工具：task_take（无需参数，接取目标 URL 就是本页的那条）、'
    + 'task_complete（summary 必填+artifacts 引用）、task_fail（稳定错误码）——收到 TASK 块或 [task-center] 通知后按其指引执行。'
    + '要读/改/炼/归档/删某一张卡时，打开 map 里的卡片详情页 URL。',
  instanceTitle: () => '卡片列表',
}

// ---- 卡片详情页（详情页 detail）---- Card detail page (the detail archetype) ----

export const NotePage: PageFC<{ noteId: string }> = (props, agent) => {
  agent.ctx.tools.register(toolOf('read_note'))
  agent.ctx.tools.register(toolOf('rewrite_note'))
  agent.ctx.tools.register(toolOf('delete_note'))
  agent.ctx.tools.register(toolOf('list_backlinks'))
  agent.ctx.tools.register(toolOf('promote_note'))
  agent.ctx.tools.register(toolOf('archive_note'))
  // 投递回报面随页挂载 / the delivery-report face rides the page
  registerPageTaskFace(agent)
  const noteId = String(props.noteId ?? '')
  // 首屏读取：本页那一张卡（effect 发起、followup 送达）
  // / the first-screen read: this page's one card (an effect starts it, a followup delivers it)
  agent.ctx.effect(async () => {
    followupText(agent, await noteFirstScreenText(agent, noteId))
    return async () => undefined
  }, 'notebook:note-first-screen')
  return (
    <blockquote>{`卡片 ${noteId} 的正文、出链与反链随后以消息送达；也可直接用 read_note 与 list_backlinks 取。`}</blockquote>
  )
}

export const NoteMeta: ComponentPageMeta<{ noteId: string }> = {
  name: 'note',
  url: `${URL_PREFIX}/note/:noteId`,
  description: '卡片详情页：查看并改写单张卡片的标题与正文（含其链接），或删除它',
  writes: true,
  unattended: {
    serves: '单张卡片读取/改写/炼成/归档类投递任务（归属 = 会话头预设）',
    level: 'L2',
    evidence: '一句话点名卡片 id 与动作结果（rewrite 带 expectedUpdatedAt；archive 点名 distilledInto 证据）；投递以 task_complete 的 summary+artifacts 收口',
    escape: 'delete_note 与 archive_note 皆 L2：投递点名动作才执行，否则回报 unattended/l2-refused；拒绝经 task_fail 带稳定码，绝不静默重试',
  },
  instructions: '这是卡片详情页，只处理 params.noteId 指定的这一张卡——这一页只干这一件事。'
    + '该卡的首屏（字段含 kind、全文、出链与反链）在打开后以一条消息送达；消息说"不存在或归属未知"时不要凭空操作。'
    + '此后变化以你调用工具返回的结果为准。'
    + '用 read_note 读取全文；用 rewrite_note 改写，携带读到的 updatedAt 作 expectedUpdatedAt 防覆盖；'
    + '改标题时所有指向旧标题的入链自动跟随（引用方正文会被改写）；'
    + '用 list_backlinks 在改写或删除前查谁链接本卡。'
    + '本卡 kind=fleeting（闪念）时用 promote_note 炼成永久卡：补完整短语标题、把 [[链接]] 全部落到已存在的卡上——'
    + 'link-unresolved 拒绝时会列出相近标题；kind=project（项目）结项时用 archive_note：distilledInto 必须点名已承接洞见的永久卡 id（蒸馏回流的证据），'
    + '证据不实会被 archive-undistilled 拒绝，仍有入链会被 card-referenced 拒绝。'
    + 'delete_note 永久删除（与 archive_note 同为本页的 L2 动作）：投递指令点名删除这张卡时视为已获显式确认、直接执行；'
    + '无人值守且无投递指令时不要删除——如实回报 unattended/l2-refused 并停在该任务，绝不挂起等确认；'
    + '卡片仍被其他卡链接时删除会被 card-referenced 拒绝并点名引用方，先改写引用方去掉链接再删。'
    + '投递到本页的任务另有三件页面作用域工具：task_take（无需参数）、task_complete（summary 必填）、task_fail（稳定错误码）。',
  instanceTitle: (params) => `卡片 #${params.noteId ?? ''}`,
}
