/**
 * 应用定义与工具收编清单（不含实现——实现全部复用兄弟工具包的构建器）。
 * The application definition and the collected-tool manifest (no
 * implementations here — every tool reuses a sibling tool package builder).
 * @module @veren/person-agent-app
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ApplicationDefinition, AppId, PageKey } from '@veren/app-registry'
import {
  buildSessionArchiveDefinition,
  buildSessionCreateDefinition,
  buildSessionDispatchDefinition,
  buildSessionPinDefinition,
  buildSessionRenameDefinition,
  buildSessionUnarchiveDefinition,
  buildSessionUnpinDefinition,
} from '@veren/person-agent-tool-session'
import type { SettlementWatch } from '@veren/person-agent-tool-session'
import {
  buildWorkspaceCreateDefinition,
  buildWorkspaceRenameDefinition,
  buildWorkspaceSessionListDefinition,
} from '@veren/person-agent-tool-workspace'
import type { SessionListOptions, WorkspaceCreateOptions } from '@veren/person-agent-tool-workspace'

/** 结算看守的默认上限：收尾输出 4000 字符、并发看守 64。目录项与页面动态注册共用同一组数值。
 * / The settlement watch's default bounds: a 4000-character closing output and 64 concurrent watches. The catalog entry and the page's dynamic registration share these values. */
export const WATCH_DEFAULTS: { maxReportChars: number; maxConcurrentWatches: number } = {
  maxReportChars: 4000,
  maxConcurrentWatches: 64,
}

// ---- 应用定义（§2.3）/ the application definition ----

export const APP_ID = 'person-agent' as AppId

/** 应用定义：entry 是应用内页面键 / the definition: entry is a page key, not a url */
export const APP_DEFINITION: ApplicationDefinition = {
  id: APP_ID,
  name: 'Person Agent',
  description: '人机桥的个人工作台：看清部署的应用、工作区、预设与模型，处理待办任务，并可新建/派发/归档会话',
  entry: 'overview' as PageKey,
  // 应用级说明（PAGE 块的「应用说明」行）：桥梁人格，写成**人格**而不是流程。
  // 数据面的事实（工作区/预设/模型长什么样）不再写进人格——它们由概览页正文
  // 每帧渲染（挂载时读一次 + PAGE-PATCH），人格只指认事实源。
  // The app-level note (the PAGE block's app line): the bridge persona,
  // written as a **character**, not a procedure. Facts about what the
  // workspaces/presets/models look like no longer live in the persona — the
  // overview body renders them (read at mount + PAGE-PATCH); the persona only
  // names the source of fact.
  instructions: [
    'You are the user\'s personal chief of staff — the bridge between the human and DSH. Your value is judgment, not labor.',
    'Before you think, think about your thinking: hold the request at arm\'s length and settle what is genuinely being asked, what kind of work this really is, what would make an answer right rather than merely plausible, and what you do not know yet. If the picture stays blurry, ask one question before acting.',
    'Form your own opinion about where a task belongs — which workspace feels like home, which preset has the right character, what the workload demands of a model — taking the overview page\'s Workspace List / Agent Preset List / Model Catalog as your knowledge of the house (their ids are in the rows). The call is yours, and you can explain it in one honest sentence. When this deployment lacks what the task truly needs, say so plainly and offer the closest alternative instead of pretending.',
    'How you talk with the user: always in Simplified Chinese (简体中文), warm and plain, like a trusted assistant talking to a friend — no jargon without a one-line explanation. Lead with the outcome: what you understood, where the work now lives, and why each choice fits, briefly.',
    'How you hand off work: create a session (session_create) and speak its first sentence (session_dispatch) — return at once, and report back when the settlement notice arrives; never poll. Name every session you create so the user recognizes the task at a glance. Write the brief in the user\'s own terms: what "done" means and acceptance checks a non-engineer could run; never prescribe the technical approach — that is the worker\'s craft. Parallelize by default: independent tasks go to different sessions at the same time; queue on one session only when the tasks truly belong there. Keep the house tidy afterwards: rename, archive, pin or unpin sessions (session_rename / session_archive / session_pin / session_unpin) as the work settles.',
    'The one carve-out from delegating: text a human will read — a document, letter, notice, README, report — you write yourself, loading the `renhua` skill first.',
  ].join('\n'),
  // toolPrefix 缺省由 id 推导为 person_agent；显式写出仅为可读性
  toolPrefix: 'person_agent',
}

// ---- 工具收编 / collected tools ----

/** 工具收编的入参：目录 dispatch 项携带的看守 + 部署开关。The collected-tools input: the watch the catalog dispatch entry carries + the deployment knobs. */
export interface CollectedToolOptions extends WorkspaceCreateOptions, SessionListOptions {
  /** 目录 dispatch 项引用的看守（由插件入口持有并随应用卸载结清）。The watch the catalog dispatch entry references (owned by the plugin entry, settled with the app). */
  readonly watch: SettlementWatch
}

/**
 * 收编既有工具：调用兄弟工具包导出的构建器，拿到与宿主注册完全同一份
 * `ToolDefinition`——这里只登记进应用工具目录，不注册到 ctx.tools，也绝不
 * 复制第二份实现。目录是静态能力面（市场/权限/发现）；页面会话里的实际挂载
 * 走两条脸：无状态工具经 meta.tools（静态声明），session_dispatch 经
 * `ctx.page.tool` 动态注册（它携带随页面视图创建/销毁的结算看守）。
 * Collect existing tools: call the sibling tool packages' exported builders to
 * obtain the very same `ToolDefinition` the host registers — this only enters
 * the app tool catalog, never ctx.tools, and never duplicates an
 * implementation. The catalog is the static capability face (market /
 * permissions / discovery); the actual mount inside a page session takes two
 * faces: stateless tools ride meta.tools (declared statically), while
 * session_dispatch is registered dynamically via `ctx.page.tool` (it carries
 * the settlement watch created and disposed with the page view).
 * @param ctx - 携带注入能力的宿主上下文。The host context carrying injected capabilities.
 * @param options - 部署开关。The deployment knobs.
 * @returns 收编的工具定义（本地名即工具名）。The collected definitions (local names).
 */
export function collectAppTools(ctx: Context, options: CollectedToolOptions): ToolDefinition[] {
  return [
    buildSessionCreateDefinition(ctx),
    buildSessionRenameDefinition(ctx),
    // 目录里的 dispatch 定义只承载能力面（市场/权限/发现）；会话内真正执行的
    // 是页面动态注册的同名定义（页面自己的看守）。目录项从不执行。
    // The catalog's dispatch definition only carries the capability face
    // (market / permissions / discovery); the one actually executed in a
    // session is the page's dynamic same-name definition (with the page's own
    // watch). The catalog entry never executes.
    buildSessionDispatchDefinition(ctx, options.watch),
    buildSessionArchiveDefinition(ctx),
    buildSessionUnarchiveDefinition(ctx),
    buildSessionPinDefinition(ctx),
    buildSessionUnpinDefinition(ctx),
    buildWorkspaceCreateDefinition(ctx, { allowCreateDirectory: options.allowCreateDirectory }),
    buildWorkspaceRenameDefinition(ctx),
    buildWorkspaceSessionListDefinition(ctx, { maxListSessions: options.maxListSessions }),
  ]
}
