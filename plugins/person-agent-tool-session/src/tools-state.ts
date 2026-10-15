// 会话状态工具：归档 / 取消归档 / 置顶 / 取消置顶，走持久化工作区注册表的
// registry-global 集合，不碰会话日志本身。
// Session state tools: archive / unarchive / pin / unpin over the durable
// workspace registry's registry-global sets; session logs are never touched.
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
// 类型-only import：拉取 workspaceRegistry 的 Context 声明合并。
// Type-only import: pull the workspaceRegistry Context declaration merging.
import type {} from '@deepseek-ai/dsh-workspace'
import type { SessionArchiveArgs, SessionTargetArgs } from './types.js'

/** registry-global 集合的四个动词，与注册表方法一一对应。 */
/** The four registry-global verbs, one-to-one with registry methods. */
type RegistryVerb = 'archiveSession' | 'unarchiveSession' | 'pinSession' | 'unpinSession'

/** 无损 JSON 输出块的统一形状（结果小而稳定，模型直接读原始值）。 */
/** The unified lossless JSON output block (small stable results, raw values). */
const jsonOutput = {
  schema: { type: 'json' } as const,
  render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }],
}

/**
 * 注册 `session_archive`：把会话放进归档集合（可要求停止运行中的工作）。
 * Register `session_archive`: move a session into the archive set (optionally stopping running work).
 * @param ctx - 携带 workspaceRegistry 的宿主上下文。The context carrying workspaceRegistry.
 */
export function registerSessionArchive(ctx: Context): () => void {
  return ctx.tools.register(
    defineTool({
      name: 'session_archive',
      description:
        'Archive one existing session so it disappears from every grouping surface. The session ' +
        'must be idle unless stopActivity is true, in which case its running work is stopped ' +
        'first. Unarchive restores it to its original position.',
      parameters: {
        sessionId: { type: 'string', required: true, description: 'The session id to archive.' },
        stopActivity: { type: 'boolean', description: 'Stop the session\'s running work instead of refusing the archive (default false).' },
      },
      output: jsonOutput,
      async execute(args: SessionArchiveArgs) {
        const id = SessionId(args.sessionId)
        await ctx.workspaceRegistry.archiveSession(id, { stopActivity: args.stopActivity === true })
        return { sessionId: args.sessionId, archived: true }
      },
      presentCall: (args) => ({
        card: 'generic',
        title: 'Archive session',
        kind: 'other',
        rawInput: args,
      }),
    }),
  )
}

/**
 * 注册 `session_unarchive`：把会话从归档集合移回原位。
 * Register `session_unarchive`: move a session out of the archive set back to its position.
 * @param ctx - 携带 workspaceRegistry 的宿主上下文。The context carrying workspaceRegistry.
 */
export function registerSessionUnarchive(ctx: Context): () => void {
  return registerSimple(ctx, 'session_unarchive', 'unarchiveSession', 'Unarchive one session; it returns to its recorded position.', 'Unarchive session')
}

/**
 * 注册 `session_pin`：把会话放进置顶集合（与归档互斥）。
 * Register `session_pin`: put a session into the pin set (mutually exclusive with archival).
 * @param ctx - 携带 workspaceRegistry 的宿主上下文。The context carrying workspaceRegistry.
 */
export function registerSessionPin(ctx: Context): () => void {
  return registerSimple(ctx, 'session_pin', 'pinSession', 'Pin one session so it surfaces ahead of unpinned sessions. Pinning an archived session is rejected.', 'Pin session')
}

/**
 * 注册 `session_unpin`：把会话从置顶集合移除。
 * Register `session_unpin`: drop a session from the pin set.
 * @param ctx - 携带 workspaceRegistry 的宿主上下文。The context carrying workspaceRegistry.
 */
export function registerSessionUnpin(ctx: Context): () => void {
  return registerSimple(ctx, 'session_unpin', 'unpinSession', 'Unpin one session; ordering falls back to the normal grouping.', 'Unpin session')
}

/**
 * 单参数状态工具的统一注册体：入参只有 sessionId，动词即注册表方法。
 * The unified body for single-argument state tools: the only argument is
 * sessionId, and the verb maps one-to-one onto a registry method.
 */
function registerSimple(ctx: Context, tool: string, verb: RegistryVerb, description: string, title: string): () => void {
  return ctx.tools.register(
    defineTool({
      name: tool,
      description,
      parameters: {
        sessionId: { type: 'string', required: true, description: 'The session id to operate on.' },
      },
      output: jsonOutput,
      async execute(args: SessionTargetArgs) {
        // 方法访问即调用：保持 receiver 绑定（注册表方法依赖 this）。
        // Method access is the call site: the receiver binding is preserved
        // (registry methods depend on this).
        type Verb = (id: ReturnType<typeof SessionId>) => Promise<void>
        const registry = ctx.workspaceRegistry as unknown as Record<RegistryVerb, Verb>
        await registry[verb](SessionId(args.sessionId))
        return { sessionId: args.sessionId, [verb]: true }
      },
      presentCall: (args) => ({
        card: 'generic',
        title,
        kind: 'other',
        rawInput: args,
      }),
    }),
  )
}
