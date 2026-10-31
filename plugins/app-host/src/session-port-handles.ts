/**
 * agent 句柄表：会话 → 本端口经 `agents.create` 拿到的句柄。只有持有者才能
 * 整体拆除该 agent；表随 agent/disposed 自动失守，retire/destroy 共用同一
 * 拆除路径（幂等）。
 * The agent handle table: session → the handle from `agents.create`. Only the
 * holder may tear the agent down whole; the table empties itself on
 * agent/disposed, and retire/destroy share the same teardown path (idempotent).
 * @module @veren/app-host/session-port-handles
 */
import type { Context } from '@deepseek-ai/cordis'
import type { AgentHandle } from '@deepseek-ai/dsh-agent'

/** 句柄表的面：登记、除名、整体拆除 / the table's face: hold, drop, dispose whole */
export interface AgentHandles {
  /** 登记新句柄（create 路径）/ hold a fresh handle (the create path) */
  hold(sessionId: string, handle: AgentHandle): void
  /** 除名（agent/disposed 路径）/ drop the entry (the agent/disposed path) */
  drop(sessionId: string): void
  /**
   * 整体拆除该会话的 agent（retire/destroy 共用；幂等）。
   * Tear the session's agent down whole (shared by retire/destroy; idempotent).
   */
  dispose(sessionId: string): Promise<void>
}

/**
 * 建句柄表：Map 收纳 + dispose 失败只告警不阻断（拆除失败不得卡住废弃链）。
 * Build the handle table: a Map plus dispose failures logged, never thrown
 * (a failed teardown must not stall the deprecation chain).
 * @param ctx - 宿主上下文（告警用）/ the host context (for warnings)
 */
export function createAgentHandles(ctx: Context): AgentHandles {
  const handles = new Map<string, AgentHandle>()
  return {
    hold: (sessionId, handle) => { handles.set(sessionId, handle) },
    drop: (sessionId) => { handles.delete(sessionId) },
    async dispose(sessionId) {
      const handle = handles.get(sessionId)
      if (handle === undefined) return
      handles.delete(sessionId)
      try {
        await handle.dispose()
      } catch (error: unknown) {
        ctx.logger.warn(`app-host: dispose(${sessionId}) failed: ${String(error)}`)
      }
    },
  }
}
