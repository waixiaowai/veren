/**
 * The pages' assembly-time slot and the first-screen texts: what a page session
 * receives as its one message right after opening.
 *
 * The slot is bound exactly once by the app registration before any page can
 * open; reading it unbound is an assembly error and fails loud. The first
 * screen is the box talking back: the list page delivers rows plus the hubs
 * (entry points), the note page delivers the card plus its two link
 * directions. Every state is stated honestly — unknown owner, empty box, read
 * failure, no links — never a silent blank.
 *
 * 页面的装配期槽位与首屏文本：页面会话打开后作为唯一一条消息收到的内容。
 *
 * 槽位由应用注册在任何页面可开之前恰好绑定一次；未绑定即取是装配错误，响亮失败。
 * 首屏就是盒在回话：列表页送行与枢纽（入口），详情页送卡片本体加两个链接方向。每种
 * 状态都如实说明——归属未知、空盒、读取失败、无链接——绝不无声空白。
 *
 * @module @veren/notebook-app/first-screen
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { BacklinkView, BoxIntakeView, CardLinkView, HubView, NotebookToolsPort, NoteView } from '@veren/notebook'

/** 首屏列表条数上限 / the first-screen list cap */
const FIRST_SCREEN_LIMIT = 50

/**
 * The module-level slot bound at assembly time: the bodies' tool registrations
 * and first-screen reads take the tool definitions and the service face from
 * here.
 * 装配时绑定的模块级槽位：组件体的工具登记与首屏读取从这里取工具定义与服务面。
 */
let services: {
  readonly port: () => NotebookToolsPort
  readonly tools: readonly ToolDefinition[]
  readonly taskFace: () => readonly ToolDefinition[]
} | undefined

/**
 * Bind the slot (called once by the app registration).
 * 绑定槽位（由应用注册调用一次）。
 */
export function bindNotebookServices(
  port: () => NotebookToolsPort,
  tools: readonly ToolDefinition[],
  taskFace: () => readonly ToolDefinition[],
): void {
  services = { port, tools, taskFace }
}

/** 取绑定的服务面；未绑定 = 装配错误 fail loud / read the bound face; unbound = assembly error, fail loud */
export function requireServices(): {
  readonly port: () => NotebookToolsPort
  readonly tools: readonly ToolDefinition[]
  readonly taskFace: () => readonly ToolDefinition[]
} {
  if (services === undefined) {
    throw new Error('[notebook-app] notebook services are not bound; registerNotebookApp must run before pages open')
  }
  return services
}

/** 归属解析：会话头 agentPreset——与页面工具取调用者的口径同源；身份不进 URL
 * / owner resolution: the session header's agentPreset — the same face the page tools read their caller from; identity never enters the url */
export function ownerOf(agent: Agent): string | null {
  return (agent.session as { header?: { agentPreset?: string } } | undefined)?.header?.agentPreset ?? null
}

/** 列表页首屏快照形状（归属未知时 available=false，不编造数据）
 * / the list page's first-screen shape (owner unknown reads available=false, never faked) */
export interface NotebookListFirstScreen {
  available: boolean
  owner: string | null
  notes: readonly { id: string; title: string; excerpt: string; updatedAt: string; kind: string }[]
  hubs: readonly HubView[]
  /** 待加工区：无入链且过保鲜窗的卡，最早优先 / the waiting list: unlinked cards past the freshness window, oldest first */
  stale: readonly { id: string; title: string; updatedAt: string }[]
  /** 谜面：共享邻居却未互链的卡对 / riddles: pairs sharing neighbors without linking */
  riddles: readonly { aTitle: string; bTitle: string; shared: number }[]
  /** 进料口：全部闪念与其中过期的 / the intake: every fleeting card and the overdue ones */
  intake: BoxIntakeView
}

/** 详情页首屏快照形状（归属未知或笔记不存在时 note 为 null）
 * / the note page's first-screen shape (note=null on unknown owner or a missing note) */
export interface NotebookNoteFirstScreen {
  owner: string | null
  note: null | (NoteView & { readonly links: CardLinkView | null })
}

/** 列表首屏渲染成 Markdown 文本（每种状态都如实表达，不静默空白）
 * / render the list first screen as Markdown text (every state stated honestly, never a silent blank) */
export function renderListFirstScreen(snap: NotebookListFirstScreen): string {
  if (!snap.available) {
    return '归属未知：本页拿不到当前会话的预设。如实告知用户；可用 list_notes 自行取列表，但不要编造笔记。'
  }
  if (snap.notes.length === 0 && snap.intake.fleet.length === 0) {
    return `预设 ${snap.owner ?? '未知'} 的卡片盒还是空的——有原始想法就用 capture_note 捕获闪念，想清楚了一卡一想法就用 write_note 写永久卡。`
  }
  const rows = snap.notes.map((note) => `- **${note.id}** ${note.title}（${note.kind === 'fleeting' ? '闪念' : note.kind === 'project' ? '项目' : '永久'}，更新于 ${note.updatedAt}）\n  ${note.excerpt}`)
  const hubs = renderHubs(snap.hubs)
  const stale = renderStale(snap.stale)
  const riddles = renderRiddles(snap.riddles)
  const intake = renderIntake(snap.intake)
  return [`笔记列表（预设 ${snap.owner ?? '未知'}）：`, ...rows, '', hubs, '', intake, '', stale, '', riddles, '', '列表此后变化以你调用工具返回的结果为准。'].join('\n')
}

/** 枢纽段：盒的入口，如实包括空态。/ The hubs section: the box's entry points, empty state stated honestly. */
function renderHubs(hubs: readonly HubView[]): string {
  if (hubs.length === 0) {
    return '盒的入口：还没有卡片互相链接——写卡时用 [[标题]] 链接相关卡，入口会自然长出来。'
  }
  const rows = hubs.map(hub => `- ${hub.title}（${hub.id}，被引 ${String(hub.inboundCount)} 次）`)
  return ['盒的入口（被链接最多的卡片，重入盒时从这里读起；list_hubs 可再取）：', ...rows].join('\n')
}

/** 待加工区段：迷失卡片浮出，如实包括空态。/ The waiting-list section: lost cards surface, empty state stated honestly. */
function renderStale(stale: readonly { id: string; title: string; updatedAt: string }[]): string {
  if (stale.length === 0) {
    return '待加工区：空——每张永久/项目卡都至少有一条入链指向它，或还在 7 天保鲜期内。'
  }
  const rows = stale.map(card => `- ${card.title}（${card.id}，放置于 ${card.updatedAt}）`)
  return ['待加工区（这些永久/项目卡还没有任何链接指向它们，且已放置超过 7 天——卢曼的迷失卡片：链上归宿，或炼成枢纽）：', ...rows].join(String.fromCharCode(10))
}

/** 进料口段：闪念队列置顶过期项，如实包括空态。/ The intake section: the fleeting queue, overdue first, empty state honest. */
function renderIntake(intake: BoxIntakeView): string {
  if (intake.fleet.length === 0) {
    return '进料口：空——没有待加工的闪念。有原始想法随时 capture_note，别让它溜走。'
  }
  const overdueIds = new Set(intake.overdue.map(row => row.id))
  const ordered = [...intake.overdue, ...intake.fleet.filter(row => !overdueIds.has(row.id))]
  const rows = ordered.map((card) => `- ${card.title}（${card.id}${overdueIds.has(card.id) ? '，已过 2 天保鲜窗' : ''}）`)
  return ['进料口（闪念只是提醒物：一两天内炼成永久卡 promote_note，或把已蒸掉的扔掉 delete_note；过期者优先）：', ...rows].join(String.fromCharCode(10))
}

/** 谜面段：意外连接的提问式提示，如实包括空态。/ The riddle section: question-form hints at unexpected connections, empty state honest. */
function renderRiddles(riddles: readonly { aTitle: string; bTitle: string; shared: number }[]): string {
  if (riddles.length === 0) {
    return '盒的谜面：暂无——卡与卡之间还没有可提出的意外连接。'
  }
  const rows = riddles.map(riddle => `- 「${riddle.aTitle}」与「${riddle.bTitle}」共享 ${String(riddle.shared)} 个邻居，却从未互链——它们该认识一下吗？`)
  return ['盒的谜面（派生提示，当谜语听；认为成立就互链）：', ...rows].join('\n')
}

/** 详情首屏渲染成 Markdown 文本 / render the note first screen as Markdown text */
export function renderNoteFirstScreen(snap: NotebookNoteFirstScreen, noteId: string): string {
  if (snap.note === null) {
    return `笔记 ${noteId} 不存在或归属未知——不要凭空操作。`
  }
  // 时间两行都给：createdAt 是事实，updatedAt 是 rewrite_note 守卫要用的值。
  // / both timestamps: createdAt is a fact, updatedAt feeds the rewrite_note guard.
  const { links } = snap.note
  return [
    `# ${snap.note.id} ${snap.note.title}`,
    `创建于 ${snap.note.createdAt} · 更新于 ${snap.note.updatedAt}`,
    '',
    snap.note.body,
    '',
    renderOutgoing(links),
    '',
    renderIncoming(links),
  ].join('\n')
}

/** 出链段 / the outgoing-links section */
function renderOutgoing(links: CardLinkView | null): string {
  if (links === null || links.outgoing.length === 0) {
    return '出链：本卡还没有 [[标题]] 链接指向其他卡。'
  }
  const rows = links.outgoing.map(row => `- ${row.targetTitle}（${row.targetId}）`)
  return ['出链（本卡指向的卡）：', ...rows].join('\n')
}

/** 反链段 / the incoming-links section */
function renderIncoming(links: CardLinkView | null): string {
  if (links === null || links.incoming.length === 0) {
    return '反链：还没有其他卡链接本卡（list_backlinks 可再查）。'
  }
  const rows: string[] = links.incoming.map(row => `- ${row.sourceTitle}（${row.sourceId}）：${row.excerpt}`)
  return ['反链（指向本卡的卡，改写或删除前先看它们）：', ...rows].join('\n')
}

/** 列表页首屏读取（组件体 lifecycle 的读半边；失败态也是信息）
 * / the list page's first-screen read (the read half of the body's lifecycle; failures are information too) */
export async function listFirstScreenText(agent: Agent): Promise<string> {
  const owner = ownerOf(agent)
  if (owner === null) {
    return renderListFirstScreen({ available: false, owner: null, notes: [], hubs: [], stale: [], riddles: [], intake: { fleet: [], overdue: [] } })
  }
  const port = requireServices().port()
  try {
    const [notes, hubs, stale, riddles, stats] = await Promise.all([
      port.list(owner), port.hubs(owner), port.stale(owner), port.riddles(owner), port.stats(owner),
    ])
    return renderListFirstScreen({
      available: true,
      owner,
      notes: notes.slice(0, FIRST_SCREEN_LIMIT).map((note) => ({
        id: note.id, title: note.title, excerpt: note.excerpt, updatedAt: note.updatedAt, kind: note.kind,
      })),
      hubs,
      stale: stale.map(card => ({ id: card.id, title: card.title, updatedAt: card.updatedAt })),
      riddles: riddles.map(riddle => ({ aTitle: riddle.aTitle, bTitle: riddle.bTitle, shared: riddle.shared })),
      intake: stats.intake,
    })
  } catch (error: unknown) {
    return `首屏读取失败：${error instanceof Error ? error.message : String(error)}。重开本页 URL 即可重取；也可用 list_notes 自行取列表。`
  }
}

/** 详情页首屏读取 / the note page's first-screen read */
export async function noteFirstScreenText(agent: Agent, noteId: string): Promise<string> {
  const owner = ownerOf(agent)
  if (owner === null) return renderNoteFirstScreen({ owner: null, note: null }, noteId)
  const port = requireServices().port()
  try {
    const [note, links] = await Promise.all([port.read(owner, noteId), port.cardLinks(owner, noteId)])
    return renderNoteFirstScreen({ owner, note: { ...note, links } }, noteId)
  } catch (error: unknown) {
    // 读取失败（卡片不存在/归属未知/存储异常）统一归入"找不到"语义——
    // 绝不凭空操作；原因如实带上。
    // / a read failure (missing card, unknown owner, storage trouble) folds into
    // the not-found semantics — never act on a ghost; the reason rides along.
    return `笔记 ${noteId} 不存在或归属未知——不要凭空操作。（读取失败：${error instanceof Error ? error.message : String(error)}）`
  }
}
