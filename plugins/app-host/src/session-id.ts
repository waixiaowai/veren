/**
 * 会话 id 的跨边界收窄：端口面（PageSessionPort）收发 plain string，跨进
 * DSH 会话机制（SessionId brand）时在此一次性收窄——零运行时开销的 brand。
 * The cross-boundary narrowing for session ids: the port face
 * (PageSessionPort) speaks plain strings; the one narrowing into the DSH
 * session machinery's SessionId brand happens here — a zero-runtime-cost
 * brand.
 * @module @veren/app-host/session-id
 */
import type { SessionId } from '@deepseek-ai/dsh-session'

/** 会话 id 的 brand 收窄：端口面收 plain string，跨边界在此一次性收窄
 * / the one brand narrowing where plain port strings cross the SessionId boundary */
export const sid = (sessionId: string): SessionId => sessionId as SessionId
