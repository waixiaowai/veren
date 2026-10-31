/** @jsxRuntime automatic @jsxImportSource @veren/prompt-core */
/**
 * 工作区浏览页（只读副页）：注册表是同步内存读——绑定 ctx 直读，零状态；
 * 异步面没有——正文即真实工作区行。四个工具在组件体就地登记（设计律：
 * 工具只在页面存在）。
 * The workspace browser page (a read-only secondary page): the registry is a
 * sync in-memory read through the bound ctx, zero state; there is no async face -
 * the body is the real workspace rows. Four tools register in place in the
 * component body (design law: a tool exists only inside a page).
 * @module @veren/person-agent-app
 */
import type { ComponentPageMeta, PageFC } from '@veren/prompt-page'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-skill'
import type {} from '@deepseek-ai/dsh-workspace'
import { requireCtx } from './page-context.ts'
import { takeWorkspaceTools } from './page-tools.ts'
import { loadRenhuaSkill } from './skills.ts'
import { URL_PREFIX } from './page-shared.ts'

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
