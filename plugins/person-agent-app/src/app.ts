/**
 * 应用定义与工具收编清单（不含实现——实现全部复用既有工具包的构建器）。
 * The application definition and the collected-tool manifest (no
 * implementations here — every tool reuses an existing tool package builder).
 * @module @veren/person-agent-app
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import type { ApplicationDefinition, AppId, PageKey } from '@veren/app-registry'
import { buildSessionCreateDefinition, buildSessionRenameDefinition } from '@veren/person-agent-tool-session'
import { buildWorkspaceSessionListDefinition } from '@veren/person-agent-tool-workspace'

// ---- 应用定义（§2.3）/ the application definition ----

export const APP_ID = 'person-agent' as AppId

/** 应用定义：entry 是应用内页面键 / the definition: entry is a page key, not a url */
export const APP_DEFINITION: ApplicationDefinition = {
  id: APP_ID,
  name: 'Person Agent',
  description: '人机桥的个人工作台：一屏看清部署、应用目录、工作区/会话与待办任务',
  entry: 'overview' as PageKey,
  instructions: 'Person Agent 是人类与 DSH 之间的桥梁。概览页展示当前部署的真实状态'
    + '（应用目录、工作区、待办任务）；工作区页浏览各工作区及其会话账目。'
    + '所有操作通过本应用挂载的 person_agent__* 工具完成，数据拿不到时页面会明确标注不可用。',
  // toolPrefix 缺省由 id 推导为 person_agent；显式写出仅为可读性
  toolPrefix: 'person_agent',
}

// ---- 工具收编 / collected tools ----

/**
 * 收编既有工具：调用兄弟工具包导出的构建器，拿到与宿主注册完全同一份
 * `ToolDefinition`——这里只登记进应用工具目录，不注册到 ctx.tools，也绝不
 * 复制第二份实现。页面工具按只读/低风险原则挑选：
 * - session_create / session_rename：会话维护，页面流程内合法；
 * - workspace_session_list：只读检索；
 * 排除项与理由见 README（派活/归档/置顶/工作区增改不适合页面会话触发）。
 * Collect existing tools: call the sibling tool packages' exported builders to
 * obtain the very same `ToolDefinition` the host registers — this only enters
 * the app tool catalog, never ctx.tools, and never duplicates an
 * implementation. Page tools are picked read-only/low-risk first; exclusions
 * and reasons live in the README.
 * @param ctx - 携带注入能力的宿主上下文。The host context carrying injected capabilities.
 * @param maxListSessions - 会话列表单次上限。The per-call session-list cap.
 * @returns 收编的工具定义（本地名即工具名）。The collected definitions (local names).
 */
export function collectAppTools(ctx: Context, maxListSessions: number): ToolDefinition[] {
  return [
    buildSessionCreateDefinition(ctx),
    buildSessionRenameDefinition(ctx),
    buildWorkspaceSessionListDefinition(ctx, { maxListSessions }),
  ]
}
