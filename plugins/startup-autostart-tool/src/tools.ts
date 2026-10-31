/**
 * The five startup tools themselves: one registration function per tool, and
 * the composer that registers them in a fixed order and unwinds in reverse.
 *
 * Each tool translates its flat arguments into one service call and turns a
 * thrown refusal into the structured error the output schema declares.
 *
 * 五个启动工具本体：每个工具一个注册函数，外加一个按固定顺序注册、逆序释放的组装器。
 * 每个工具把扁平参数翻译成一次服务调用，并把抛出的拒绝转换为输出 schema 声明的结构化
 * 错误。
 * @module @veren/startup-autostart-tool/tools
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { StartupItemView, StartupOutcome } from '@veren/startup-autostart'
import {
  CREATE_DESCRIPTION, DELETE_DESCRIPTION, LIST_DESCRIPTION, RUN_DESCRIPTION, UPDATE_DESCRIPTION,
} from './descriptions.ts'
import { checkedToolId, operationError, present, renderValue, toInput } from './mapping.ts'
import type { StartupToolError } from './mapping.ts'
import {
  DELETE_OUTPUT_SCHEMA, ITEM_OUTPUT_SCHEMA, ITEM_PARAMETERS, LIST_OUTPUT_SCHEMA, RUN_OUTPUT_SCHEMA,
} from './schemas.ts'

/** Register `startup_create`: register one startup item. */
function registerStartupCreate(ctx: Context): () => void {
  return ctx.tools.register(defineTool({
    name: 'startup_create',
    description: CREATE_DESCRIPTION,
    parameters: ITEM_PARAMETERS,
    output: { schema: ITEM_OUTPUT_SCHEMA, render: renderValue },
    async execute(args): Promise<StartupItemView | StartupToolError> {
      try {
        return await ctx.startupAutostart.create(toInput(args))
      } catch (error: unknown) {
        return operationError(error)
      }
    },
    presentCall: args => present('Register startup item', 'other', args.name),
  }))
}

/** Register `startup_list`: read every item without starting a session. */
function registerStartupList(ctx: Context): () => void {
  return ctx.tools.register(defineTool({
    name: 'startup_list',
    description: LIST_DESCRIPTION,
    parameters: {},
    output: { schema: LIST_OUTPUT_SCHEMA, render: renderValue },
    async execute(): Promise<StartupItemView[] | StartupToolError> {
      try {
        return await ctx.startupAutostart.catalog()
      } catch (error: unknown) {
        return operationError(error)
      }
    },
    presentCall: () => present('List startup items', 'read'),
  }))
}

/** Register `startup_update`: edit one item in place. */
function registerStartupUpdate(ctx: Context): () => void {
  return ctx.tools.register(defineTool({
    name: 'startup_update',
    description: UPDATE_DESCRIPTION,
    parameters: {
      id: { type: 'string', required: true, description: 'Startup item id returned by startup_list.' },
      ...ITEM_PARAMETERS,
    },
    output: { schema: ITEM_OUTPUT_SCHEMA, render: renderValue },
    async execute(args): Promise<StartupItemView | StartupToolError> {
      const invalid = checkedToolId(args.id)
      if (invalid !== undefined) return invalid
      try {
        return await ctx.startupAutostart.update({ id: args.id, ...toInput(args) })
      } catch (error: unknown) {
        return operationError(error)
      }
    },
    presentCall: args => present('Update startup item', 'other', args.id),
  }))
}

/** Register `startup_delete`: remove one item for good. */
function registerStartupDelete(ctx: Context): () => void {
  return ctx.tools.register(defineTool({
    name: 'startup_delete',
    description: DELETE_DESCRIPTION,
    parameters: {
      id: { type: 'string', required: true, description: 'Exact startup item id.' },
    },
    output: { schema: DELETE_OUTPUT_SCHEMA, render: renderValue },
    async execute(args): Promise<{ id: string; deleted: boolean } | StartupToolError> {
      const invalid = checkedToolId(args.id)
      if (invalid !== undefined) return invalid
      try {
        return await ctx.startupAutostart.delete({ id: args.id })
      } catch (error: unknown) {
        return operationError(error)
      }
    },
    presentCall: args => present('Delete startup item', 'other', args.id),
  }))
}

/** Register `startup_run`: run one item now, `force` overriding the enabled gate. */
function registerStartupRun(ctx: Context): () => void {
  return ctx.tools.register(defineTool({
    name: 'startup_run',
    description: RUN_DESCRIPTION,
    parameters: {
      id: { type: 'string', required: true, description: 'Exact startup item id.' },
      force: { type: 'boolean', description: 'Run even when the item is disabled.' },
    },
    output: { schema: RUN_OUTPUT_SCHEMA, render: renderValue },
    async execute(args): Promise<{ id: string; outcome: StartupOutcome } | StartupToolError> {
      const invalid = checkedToolId(args.id)
      if (invalid !== undefined) return invalid
      try {
        return await ctx.startupAutostart.run({
          id: args.id,
          ...args.force === undefined ? {} : { force: args.force },
        })
      } catch (error: unknown) {
        return operationError(error)
      }
    },
    presentCall: args => present('Run startup item now', 'other', args.id),
  }))
}

/**
 * Register the five tools in the scope that resolved the startup service.
 * @param ctx - Scope whose `startupAutostart` service the tools act through.
 * @returns disposer removing every registration in reverse order.
 */
export function registerStartupTools(ctx: Context): () => void {
  // Fixed registration order; disposal unwinds it in reverse.
  const disposers = [
    registerStartupCreate(ctx),
    registerStartupList(ctx),
    registerStartupUpdate(ctx),
    registerStartupDelete(ctx),
    registerStartupRun(ctx),
  ]
  return () => { for (const dispose of disposers.reverse()) dispose() }
}
