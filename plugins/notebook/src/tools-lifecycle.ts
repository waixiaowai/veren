/**
 * The lifecycle tool builders: the two transition verbs a page session uses to
 * move cards through the flywheel — `promote_note` (fleeting → permanent, the
 * compounding step) and `archive_note` (project → gone, with distill-back
 * evidence). They live page-side with rewrite_note and delete_note: processing
 * a card wants the card's first screen open, and archive deletes. No
 * registration here — the mounter defines them into the app catalog; the owner
 * is read from the live Agent on every call.
 *
 * 生命周期工具构建器：页面会话用来让卡片走过飞轮的两个转移动词——`promote_note`
 * （闪念 → 永久，化合步）与 `archive_note`（项目 → 消失，凭蒸馏证据）。它们与
 * rewrite_note/delete_note 一样住在页面：加工一张卡要看见卡的首屏，而 archive
 * 会删除。本文件不做注册——挂载方把它们 define 进应用目录；归属在每次调用时取自
 * 活着的 Agent。
 *
 * @module @veren/notebook/tools-lifecycle
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { notebookToolValue, present, renderValue } from './tools.ts'
import type { NotebookToolsPort } from './types.ts'

/** Canonical single-note value (shared shape with the CRUD builders). 规范单卡值（与 CRUD 构建器同形）。 */
const NOTE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    note: { type: 'json', required: true },
  },
} as const

/** Canonical archive value: whether the project card is gone. 规范归档值：项目卡是否已消失。 */
const ARCHIVE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    archived: { type: 'boolean', required: true },
  },
} as const

/** 炼成工具构建器：把闪念炼成永久卡 / the promote tool builder: distill a fleeting card into a permanent one */
export function buildNotebookPromoteDefinition(ctx: Context, port: () => NotebookToolsPort): ToolDefinition {
  return defineTool({
    name: 'promote_note',
    description: 'Promote one fleeting card of the caller preset\u2019s card box into a PERMANENT card \u2014 the '
      + 'compounding step of the method. At this moment the full write-time discipline applies: the title becomes '
      + 'a complete phrase (the current one is kept when omitted), the body\u2019s [[links]] must all resolve '
      + '(the refusal lists near-miss titles), and the card joins the link graph. Refused with kind-mismatch on a '
      + 'card that is not fleeting. Parameters: id, title?, body?, expectedUpdatedAt?.',
    parameters: {
      id: { type: 'string', description: '闪念卡 id，来自 list_notes（kind: fleeting）', required: true },
      title: { type: 'string', description: '永久卡标题（完整短语）；省略则沿用闪念现题' },
      body: { type: 'string', description: '永久卡正文；省略则沿用闪念正文；[[标题]] 目标必须已存在' },
      expectedUpdatedAt: { type: 'string', description: '上次读到的 updatedAt；卡片已被改动时本次炼成被拒' },
    },
    output: { schema: NOTE_SCHEMA, render: renderValue },
    execute: (args, exec) => notebookToolValue(ctx, exec.agent, async owner => ({
      note: await port().promote(owner, args.id, {
        ...(args.title === undefined ? {} : { title: args.title }),
        ...(args.body === undefined ? {} : { body: args.body }),
        ...(args.expectedUpdatedAt === undefined ? {} : { expectedUpdatedAt: args.expectedUpdatedAt }),
      }),
    })),
    presentCall: args => present('炼成永久卡', 'other', args.id),
  })
}

/** 归档工具构建器：凭蒸馏证据结项一张项目卡 / the archive tool builder: close one project card with distill-back evidence */
export function buildNotebookArchiveDefinition(ctx: Context, port: () => NotebookToolsPort): ToolDefinition {
  return defineTool({
    name: 'archive_note',
    description: 'Archive one PROJECT card of the caller preset\u2019s card box \u2014 close the project the '
      + 'Ahrens way: the insights must have migrated FIRST, so distilledInto must name the id(s) of the permanent '
      + 'card(s) that absorbed the value; the project card is then deleted for good. Refused with '
      + 'archive-undistilled while the evidence is empty, missing, or points at non-permanent cards, with '
      + 'card-referenced while other cards still link this one, with kind-mismatch on a card that is not a project '
      + 'card. Parameters: id, distilledInto.',
    parameters: {
      id: { type: 'string', description: '项目卡 id，来自 list_notes（kind: project）', required: true },
      distilledInto: {
        type: 'array', description: '承接了本项目洞见的永久卡 id 列表（蒸馏回流的证据，须已存在）',
        items: { type: 'string' }, required: true,
      },
    },
    output: { schema: ARCHIVE_SCHEMA, render: renderValue },
    execute: (args, exec) => notebookToolValue(ctx, exec.agent,
      async owner => (await port().archive(owner, args.id, args.distilledInto))),
    presentCall: args => present('归档项目卡', 'other', args.id),
  })
}
