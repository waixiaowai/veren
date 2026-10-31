/**
 * `page_send` 投递运行时：按 URL 幂等投递（§3.9）。
 * The `page_send` delivery runtime: idempotent URL-addressed delivery (§3.9).
 *
 * 语义：规范化 URL → 查页面实例索引——该 URL 有存活会话则直接 append 一条消息
 * （唤醒它干活）；没有则新建会话（沿用 openUrl 的两阶段创建路径，同 URL 旧会话
 * 废弃，§3.5.3）再投递。返回 `sessionId + created`。它解决"投递"，不解决
 * "切换"：新建路径不发 GUI focus，绝不做成导航。
 * Semantics: canonicalize the url → consult the instance index — a live session
 * gets the message appended (waking it to work); otherwise a fresh session is
 * created (the same two-phase openUrl path; the previous one deprecates, §3.5.3)
 * and the message is delivered. Returns `sessionId + created`. It solves
 * delivery, not switching: the create path never emits a GUI focus.
 *
 * 三个风险在此构造性收口：
 * 1. 级联：{@link HopLedger} 记录每条会话的投递链深，{@link deliverToPageUrl}
 *    在入口做硬上限检查，超限抛 `page/hop-limit`——闸门在本模块一处，任何调用方
 *    都绕不过（不靠调用方自觉）；
 * 2. 成本：唤醒策略由调用方逐次选择（`wake`，缺省 true）；wake=false 只落
 *    会话日志，不产生模型回合；
 * 3. 废弃竞态：投递后重查索引，指针已易主则把消息补投给当前活会话（有限次
 *    {@link MAX_DELIVERY_ATTEMPTS}），结果如实带 `redirected` 标记。
 * The three risks close structurally here:
 * 1. Cascade: the HopLedger tracks each session's chain depth; the entry check
 *    refuses past the hard cap with `page/hop-limit` — one gate in this module,
 *    unbypassable by any caller.
 * 2. Cost: the caller picks the wake policy per call (`wake`, default true);
 *    wake=false only lands in the session log — no model round.
 * 3. Deprecation race: after appending, the index is re-consulted; if the
 *    pointer moved, the message is re-delivered to the current live session
 *    (bounded by MAX_DELIVERY_ATTEMPTS) and the result reports `redirected`.
 *
 * @module @veren/page-registry/delivery
 */
import { PageError, PageErrorCode } from '@veren/prompt-page'
import type { PageInstanceIndex, PageInstanceKey, PageMatch } from '@veren/prompt-page'
import type { AppRecord } from '@veren/app-registry'
import { createPageSession, deprecatePrevious } from './open-page.ts'
import { resolvePageTarget } from './resolve-target.ts'
import type { PageRuntimePorts, PageSessionPort } from './runtime-ports.ts'

/** 投递链硬上限（跳数）：A→B→C→D 允许，第 5 跳拒绝 / the hard hop cap */
export const MAX_DELIVERY_HOPS = 4

/** 废弃竞态下的补投上限 / the re-delivery bound under the deprecation race */
export const MAX_DELIVERY_ATTEMPTS = 3

/** 投递来源标记（会话端口的 source）/ the delivery source marker */
export const PAGE_SEND_SOURCE = 'page/send'

/** deliverToPageUrl 的入参 / delivery input */
export interface DeliverPageOptions {
  /** 投给目标页面的消息正文 / the message body for the target page */
  readonly message: string
  /** 缺省 true：唤醒目标 agent（一次模型回合）；false 只落日志不唤醒 */
  readonly wake?: boolean
  /** 调用方会话（工具经 exec.agent 注入）；缺席 = 人/宿主，链深 0 */
  readonly callerSessionId?: string
  /**
   * 在 append（唤醒）**之前**武装回执。时序是正确性的关键：append 即唤醒，
   * 目标的 turn/start 可能赶在投递函数返回之后、调用方 arm 之前——先武装
   * 才保证回执台账看得到回应回合的 turn/start（真机竞态：list 页投递的
   * 回执因 arm 晚于 turn/start 被边界判定当成旧回合而永未发出）。
   * Arm the receipt BEFORE the append (the wake). Ordering is correctness:
   * the append wakes the target, whose turn/start can beat the caller's
   * post-return arm — arming first guarantees the ledger sees the answering
   * turn's turn/start (live race: a list-page delivery's receipt never fired
   * because arm landed after turn/start and the boundary check read the
   * answering round as a pre-arm one).
   */
  readonly armReceipt?: (targetSessionId: string, url: PageInstanceKey) => void
}

/** 投递回执 / the delivery receipt */
export interface DeliveryResult {
  readonly sessionId: string
  readonly url: string
  /** true = 本次新建了页面会话；false = 投给了既有活会话 */
  readonly created: boolean
  /** true = 投递途中指针易主，消息补投给了当前活会话（废弃竞态） */
  readonly redirected: boolean
  /** true = 应武装回执：唤醒投递 + 调用方在席 + 非自投（service 据此 arm；
   * 目标唤醒回合结束时，其最终回答以 PAGE-RECEIPT 落回调用方日志）*/
  readonly receipt: boolean
}

/** 回执判据（三个返回点共用）/ the receipt verdict (shared by all three returns) */
function receiptOf(
  sessionId: string,
  url: PageInstanceKey,
  created: boolean,
  options: DeliverPageOptions,
  redirected: boolean,
): DeliveryResult {
  return {
    sessionId,
    url,
    created,
    redirected,
    receipt: options.wake !== false
      && options.callerSessionId !== undefined
      && sessionId !== options.callerSessionId,
  }
}

/**
 * 投递链深台账：sessionId → 该会话被投递创建/续链时的链深。进程内即够——
 * 级联是活递归现象，重启清零不放大风险；会话消失时条目随之清除（consult 时
 * 惰性清理，不设后台扫描）。
 * The hop ledger: sessionId → the chain depth recorded when the session was
 * created/extended by a delivery. In-process suffices — cascade is a live
 * recursion; a restart resets it and cannot amplify risk. Entries whose session
 * is gone are pruned lazily on consult (no background scan).
 */
export class HopLedger {
  private readonly depth = new Map<string, number>()

  /** 读一条会话的链深；缺席或会话已不在 → 0 / depth of a session; 0 when absent or gone */
  depthOf(sessions: PageSessionPort, sessionId: string | undefined): number {
    if (sessionId === undefined) return 0
    const known = this.depth.get(sessionId)
    if (known === undefined) return 0
    if (!sessions.exists(sessionId)) {
      this.depth.delete(sessionId)
      return 0
    }
    return known
  }

  /** 记录/抬升一条会话的链深 / record (or raise) a session's chain depth */
  record(sessionId: string, depth: number): void {
    this.depth.set(sessionId, depth)
  }
}

/**
 * 按 URL 幂等投递（§3.9）：有活会话则 append，无则新建再投。
 * Deliver to a url idempotently (§3.9): append to the live session, or create
 * one first.
 */
export async function deliverToPageUrl(
  registry: { resolve(url: string): PageMatch<never> | null },
  index: PageInstanceIndex,
  ports: PageRuntimePorts,
  ledger: HopLedger,
  url: string,
  options: DeliverPageOptions,
): Promise<DeliveryResult> {
  const { key, app, match } = resolvePageTarget(registry, ports, url)
  const callerDepth = ledger.depthOf(ports.sessions, options.callerSessionId)
  const nextDepth = callerDepth + 1
  // 硬上限：构造上的闸门，任何调用方都在这里被拦 / the hard cap: the structural gate
  if (nextDepth > MAX_DELIVERY_HOPS) {
    throw new PageError(PageErrorCode.HopLimit,
      `delivery chain would reach ${nextDepth} hops (cap ${MAX_DELIVERY_HOPS}); caller ${options.callerSessionId ?? '(none)'} refused for ${key}`)
  }
  return await deliverWithRetry(index, ports, ledger, key, app, match, options, nextDepth)
}

/** 有限次投递循环：活会话直接 append；废弃竞态下指针易主则补投 / the bounded delivery loop: append to the live session; re-deliver when the pointer moves */
async function deliverWithRetry(
  index: PageInstanceIndex,
  ports: PageRuntimePorts,
  ledger: HopLedger,
  key: PageInstanceKey,
  app: AppRecord,
  match: PageMatch<never>,
  options: DeliverPageOptions,
  nextDepth: number,
): Promise<DeliveryResult> {
  let redirected = false
  let lastSessionId = ''
  for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS; attempt++) {
    const row = await index.lookup(key)
    // 活行还要"会话在场"：重启后所有旧会话都未激活，append 会以
    // "found no active agent" 失败——视为无活会话，走新建路径（旧行经
    // openUrl 同款废弃收编，墓碑照写）。真机反例：投给重启前的 t-3 详情
    // 页两次均失败，发送方只拿到错误。
    // A live row also needs its session PRESENT: after a restart every old
    // session is inactive and append fails with "found no active agent" —
    // treat that as no live session and create (the old row retires through
    // the same openUrl path, tombstone included). Live counter-example:
    // delivering to a pre-restart detail page failed twice with that error.
    if (row === undefined || row.state !== 'live' || !ports.sessions.exists(row.sessionId)) {
      return await createAndDeliver(index, ports, ledger, key, app, match, options, nextDepth, redirected)
    }
    lastSessionId = row.sessionId
    // 续链：目标链深至少是 caller+1（既有的浅会话被更深的链投递时抬升）
    // Chain extension: the target's depth is at least caller+1 (raised when a shallower session is handed deeper work)
    ledger.record(row.sessionId, Math.max(ledger.depthOf(ports.sessions, row.sessionId), nextDepth))
    options.armReceipt?.(row.sessionId, key)
    await ports.sessions.appendUserMessage(row.sessionId, options.message, PAGE_SEND_SOURCE, { wake: options.wake })
    // 废弃竞态（§3.9 风险 3）：投递后重查；指针已易主 → 补投给当前活会话
    // Deprecation race: re-consult after appending; pointer moved → re-deliver
    const current = await index.lookup(key)
    if (current !== undefined && current.state === 'live' && current.sessionId === row.sessionId) {
      return receiptOf(row.sessionId, key, false, options, redirected)
    }
    redirected = true
  }
  // 补投次数用尽：最后一次投递保留在它落地的会话，如实回报 redirected
  // Attempts exhausted: the last append stands where it landed; report honestly
  return receiptOf(lastSessionId, key, false, options, redirected)
}

/** 无活会话的新建路径：正规废弃腾位 → 两阶段创建（不 focus）→ 记链深 → 武装回执 → append / the create path: regular deprecation frees the url → two-phase create (no focus) → record depth → arm receipt → append */
async function createAndDeliver(
  index: PageInstanceIndex,
  ports: PageRuntimePorts,
  ledger: HopLedger,
  key: PageInstanceKey,
  app: AppRecord,
  match: PageMatch<never>,
  options: DeliverPageOptions,
  nextDepth: number,
  redirected: boolean,
): Promise<DeliveryResult> {
  // 无活会话：新建（同 openUrl 创建路径；不 focus——投递不是导航）。占了
  // URL 的"活行但会话不在场"旧行先经正规废弃腾位（retire 失败不阻断、墓碑
  // 必写），否则 reserve 撞 page/index-conflict。
  // No live session: create (the openUrl path; no focus — not navigation).
  // A stale "live row, absent session" must first free the url through the
  // regular deprecation (retire failures never block, the tombstone always
  // lands), or reserve hits page/index-conflict.
  await deprecatePrevious(index, ports, key)
  const created = await createPageSession(index, ports, key, app, match, { focus: false })
  ledger.record(created.sessionId, nextDepth)
  // 武装必须先于 append（唤醒）：见 DeliverPageOptions.armReceipt 的时序注释
  // / arming must precede the append (the wake): see the ordering note on
  // DeliverPageOptions.armReceipt
  options.armReceipt?.(created.sessionId, key)
  await ports.sessions.appendUserMessage(created.sessionId, options.message, PAGE_SEND_SOURCE, { wake: options.wake })
  return receiptOf(created.sessionId, key, true, options, redirected)
}
