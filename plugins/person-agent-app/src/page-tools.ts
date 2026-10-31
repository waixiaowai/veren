/**
 * 两页的工具预挂面：绑定 ctx 就绪后惰性构建并缓存；builder 产出本地名，
 * `named` 登记时升格为对外全名 `person_agent__<本地名>`。
 * The two pages' prebuilt tool sets: built lazily once the bound ctx is ready
 * and cached; builders produce local names, and `named` promotes a definition to
 * its external full name `person_agent__<local>` at registration.
 * @module @veren/person-agent-app
 */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import {
  buildSessionArchiveDefinition,
  buildSessionCreateDefinition,
  buildSessionPinDefinition,
  buildSessionRenameDefinition,
  buildSessionUnarchiveDefinition,
  buildSessionUnpinDefinition,
} from '@veren/person-agent-tool-session'
import {
  buildWorkspaceCreateDefinition,
  buildWorkspaceRenameDefinition,
  buildWorkspaceSessionListDefinition,
} from '@veren/person-agent-tool-workspace'
import { externalName } from './page-shared.ts'
import { requireCtx } from './page-context.ts'

/** 工具全名化 / full-name a builder product */
export const named = (definition: ToolDefinition): ToolDefinition => ({ ...definition, name: externalName(definition.name) })

/** 概览页的九件无状态工具（惰性首取后缓存）/ the overview's nine stateless tools (lazy, cached on first take) */
let overviewTools: readonly ToolDefinition[] | undefined
export function takeOverviewTools(): readonly ToolDefinition[] {
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
export function takeWorkspaceTools(): readonly ToolDefinition[] {
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
