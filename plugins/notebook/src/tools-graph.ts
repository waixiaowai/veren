/**
 * The graph tool builders: the box's two "talking back" operations.
 *
 * `list_backlinks` answers "who points here" for one card — the
 * conversation-partner face of the method; `list_hubs` returns the box's
 * entry points, ranked by inbound links. They read the same derived cache
 * every card write maintains, and like the five CRUD builders they carry no
 * registration: the mounter (today `@veren/notebook-app`) defines them into
 * the app catalog and the page bodies register them under their full names.
 * The owner is read from the live Agent on every call and is never a
 * parameter.
 *
 * 图谱工具构建器：盒的两件「回话」操作。
 *
 * `list_backlinks` 回答某张卡「谁指向这里」——方法的对话伙伴面；`list_hubs` 返回
 * 盒的入口，按入链数排名。两者读的都是每次卡片写入维护的同一份派生缓存，且与五件
 * CRUD 构建器一样不做注册：挂载方（今天是 `@veren/notebook-app`）把它们 define 进
 * 应用目录，页面组件体以全名登记。归属在每次调用时取自活着的 Agent，永远不是参数。
 *
 * @module @veren/notebook/tools-graph
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { notebookToolValue, present, renderValue } from './tools.ts'
import type { NotebookToolsPort } from './types.ts'

/** Canonical backlinks value: who links to the queried card. 规范反链值：谁链到被查的卡。 */
const BACKLINKS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    backlinks: { type: 'array', required: true, items: { type: 'json' } },
  },
} as const

/** Canonical hubs value: the box's entry points by inbound links. 规范枢纽值：按入链数排的盒入口。 */
const HUBS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    hubs: { type: 'array', required: true, items: { type: 'json' } },
  },
} as const

/** Canonical find value: cards whose title contains a fragment. 规范寻卡值：标题含片段的卡片。 */
const FIND_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    cards: { type: 'array', required: true, items: { type: 'json' } },
  },
} as const

/** 反链工具构建器：读链到某张卡的那些卡 / the backlinks tool builder: the cards that link to one card */
export function buildNotebookBacklinksDefinition(ctx: Context, port: () => NotebookToolsPort): ToolDefinition {
  return defineTool({
    name: 'list_backlinks',
    description: 'List the cards of the caller preset\u2019s card box that link to one card \u2014 the box '
      + 'answering back. Read these before rewriting or deleting a card, and after writing one, to place the '
      + 'idea in its neighborhood. Parameters: id.',
    parameters: {
      id: { type: 'string', description: '卡片 id，来自 list_notes', required: true },
    },
    output: { schema: BACKLINKS_SCHEMA, render: renderValue },
    execute: (args, exec) => notebookToolValue(ctx, exec.agent,
      async owner => ({ backlinks: await port().backlinks(owner, args.id) })),
    presentCall: args => present('读取反链', 'read', args.id),
  })
}

/** 枢纽工具构建器：读盒的入口卡 / the hubs tool builder: the box's entry-point cards */
export function buildNotebookHubsDefinition(ctx: Context, port: () => NotebookToolsPort): ToolDefinition {
  return defineTool({
    name: 'list_hubs',
    description: 'List the most-linked cards of the caller preset\u2019s card box \u2014 its entry points. '
      + 'Start a tour of the box here when re-entering it after a break. Parameters: none.',
    parameters: {},
    output: { schema: HUBS_SCHEMA, render: renderValue },
    execute: (_args, exec) => notebookToolValue(ctx, exec.agent,
      async owner => ({ hubs: await port().hubs(owner) })),
    presentCall: () => present('读取枢纽', 'read'),
  })
}

/** Canonical stats value: the box's breathing readout. 规范读数值：盒的呼吸读数。 */
const STATS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    stats: { type: 'json', required: true },
  },
} as const

/** 呼吸读数工具构建器：盒的飞轮仪表 / the stats tool builder: the box's flywheel readout */
export function buildNotebookStatsDefinition(ctx: Context, port: () => NotebookToolsPort): ToolDefinition {
  return defineTool({
    name: 'box_stats',
    description: 'Read the caller preset\u2019s box breathing readout \u2014 the flywheel\u2019s numbers: card '
      + 'counts per kind (fleeting/permanent/project), link density over the graph citizens, the intake queue '
      + '(every fleeting card plus the overdue ones to process first), and the 7-day lifecycle rates (captured, '
      + 'promoted, trashed, archived, riddles closed). Consult it when deciding what the box needs next; a box '
      + 'that only grows without promoting is a hoard, not a second brain. Parameters: none.',
    parameters: {},
    output: { schema: STATS_SCHEMA, render: renderValue },
    execute: (_args, exec) => notebookToolValue(ctx, exec.agent,
      async owner => ({ stats: await port().stats(owner) })),
    presentCall: () => present('读取盒读数', 'read'),
  })
}

/** 寻卡工具构建器：按标题片段找卡 / the find tool builder: cards whose title contains a fragment */
export function buildNotebookFindDefinition(ctx: Context, port: () => NotebookToolsPort): ToolDefinition {
  return defineTool({
    name: 'find_cards',
    description: 'Find the caller preset\u2019s cards whose TITLE contains a fragment \u2014 titles are link '
      + 'addresses, so this is the cheap way to locate an older card, survey a topic by its title prefix, or '
      + 'check for a near-duplicate title before writing. Exact contains-match (case- and normalization-'
      + 'sensitive, never fuzzy), newest first, at most 20 rows. Parameters: query.',
    parameters: {
      query: { type: 'string', description: '标题片段，精确包含匹配（区分大小写、不做归一、不搜正文）', required: true },
    },
    output: { schema: FIND_SCHEMA, render: renderValue },
    execute: (args, exec) => notebookToolValue(ctx, exec.agent,
      async owner => ({ cards: await port().find(owner, args.query) })),
    presentCall: args => present('按标题找卡', 'read', args.query),
  })
}
