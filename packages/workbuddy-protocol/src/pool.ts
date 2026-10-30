/**
 * 多账号池：环序轮换 + 会话粘性 + 冷却过滤，全部纯函数可离线测。
 * The multi-account pool: ring rotation, session stickiness, cooldown
 * filtering — pure functions, testable offline.
 *
 * 规则（全部是账号安全/可用性不变式）：
 * - 未过期令牌优先：把一次刷新周期（与一次轮换）花在别的账号本可原样服务的
 *   请求上，是浪费。
 * - 冷却中的账号不选：刚失败的账号要撞的正是冷却要避的失败。
 * - 全冷却时服务**最快恢复**的账号：拒绝会让整个池子不可用；个人装机的最小
 *   坏账号短等好过硬失败。
 * - 粘性**不粘坏账号**：钉住的账号只有仍可选（未冷却未停用）才续用——钉住
 *   的会话不得绕过冷却。
 * Rules (all availability/account-safety invariants): prefer unexpired tokens;
 * skip cooled accounts; when everything is cooled serve the soonest-to-recover;
 * stickiness never sticks to a bad account (a pinned conversation must not
 * bypass cooldown).
 *
 * 证据：docs/workbuddy-protocol.cn.md §8；卷宗 store.ts。
 * Evidence: docs/workbuddy-protocol.md §8; dossier store.ts.
 *
 * @module @veren/workbuddy-protocol/pool
 */

/** 池需要的账号最小视图。The minimal account view the pool needs. */
export interface PoolAccount {
  readonly uid: string
  readonly expiresAtMs: number
}

/** 轮换选择的一个决定。One rotation decision. */
export interface PoolDecision<T extends PoolAccount> {
  readonly account: T
  readonly nextCursor: number
}

/** 会话钉住的存活期。How long a conversation keeps its pinned account. */
export const SESSION_AFFINITY_TTL_MS = 30 * 60_000

/**
 * 环序轮换选号（纯函数）。偏好序：未冷却 > 环序；未过期优先（全过期才用过
 * 期的兜底）。全冷却时按恢复时间取最早。
 * Rotating selection (pure). Preference: uncooled, in ring order; unexpired
 * preferred (expired serve only as the fallback). Everything cooled: earliest
 * recovery wins.
 */
export function chooseRotating<T extends PoolAccount>(
  accounts: readonly T[],
  cursor: number,
  cooldownUntilMs: ReadonlyMap<string, number>,
  now: number,
): PoolDecision<T> | undefined {
  if (accounts.length === 0) return undefined
  const live = accounts.filter(account => account.expiresAtMs > now)
  const base = live.length > 0 ? live : accounts
  const ready = base.filter(account => (cooldownUntilMs.get(account.uid) ?? 0) <= now)
  if (ready.length > 0) {
    const index = ((cursor % ready.length) + ready.length) % ready.length
    return { account: ready[index] as T, nextCursor: (index + 1) % ready.length }
  }
  // 全冷却：按恢复序取最早，而不是无人服务。此时环序无意义。
  // Everything cooled: soonest recovery, not nobody. Ring order is irrelevant here.
  const soonest = [...base].sort((a, b) => (cooldownUntilMs.get(a.uid) ?? 0) - (cooldownUntilMs.get(b.uid) ?? 0))[0]
  return soonest === undefined ? undefined : { account: soonest, nextCursor: 0 }
}

/**
 * 一个区域的池状态：游标、冷却、粘性都在内存（冷却的持久化由宿主壳层写入
 * 凭据文档；重启后从文档读回——重启不得复活一小时内耗尽额度的账号）。
 * One region's pool state: cursor, cooldowns and affinity in memory; cooldown
 * persistence is the shell's job (written into the credential document and
 * read back — a restart must not resurrect an account that just exhausted its
 * credit).
 */
export class RegionPool<T extends PoolAccount> {
  private cursor = 0
  private readonly cooldownUntilMs = new Map<string, number>()
  private readonly affinity = new Map<string, { uid: string; expiresAt: number }>()

  constructor(
    /** 账号供给（每次决策现读：停用/登出即刻生效）。The account supplier (read per decision: toggles and logouts apply immediately). */
    private readonly accounts: () => readonly T[],
    private readonly now: () => number = Date.now,
  ) {}

  /** 预置冷却（壳层从持久文档读回时灌入）。Seed a cooldown (the shell loads the persisted document). */
  seedCooldown(uid: string, untilMs: number): void {
    this.cooldownUntilMs.set(uid, untilMs)
  }

  /** 记录一次失败冷却。Note one failure cooldown. */
  noteCooldown(uid: string, untilMs: number): void {
    this.cooldownUntilMs.set(uid, untilMs)
  }

  /** 读取冷却表（壳层持久化用）。Read the cooldown map (the shell persists it). */
  cooldowns(): ReadonlyMap<string, number> {
    return this.cooldownUntilMs
  }

  /** 清除一个账号的全部池内痕迹（登出）。Drop every in-pool trace of one account (logout). */
  forget(uid: string): void {
    this.cooldownUntilMs.delete(uid)
    for (const [key, entry] of this.affinity) {
      if (entry.uid === uid) this.affinity.delete(key)
    }
  }

  private pinnedUid(sessionKey: string | undefined): string | undefined {
    if (sessionKey === undefined) return undefined
    const entry = this.affinity.get(sessionKey)
    if (entry === undefined) return undefined
    if (entry.expiresAt <= this.now()) {
      this.affinity.delete(sessionKey)
      return undefined
    }
    return entry.uid
  }

  private pin(sessionKey: string | undefined, uid: string): void {
    if (sessionKey === undefined) return
    this.affinity.set(sessionKey, { uid, expiresAt: this.now() + SESSION_AFFINITY_TTL_MS })
  }

  /**
   * 选下一个服务账号：粘性优先（仅当钉住的账号仍可选），否则轮换并钉住。
   * Pick the next serving account: stickiness first (only while still
   * selectable), else rotate and pin.
   */
  resolve(sessionKey: string | undefined): T | undefined {
    const now = this.now()
    const candidates = this.accounts()
    const selectable = (account: T): boolean => (this.cooldownUntilMs.get(account.uid) ?? 0) <= now
    const pinned = this.pinnedUid(sessionKey)
    if (pinned !== undefined) {
      const stuck = candidates.find(account => account.uid === pinned && selectable(account))
      if (stuck !== undefined) {
        this.pin(sessionKey, stuck.uid)
        return stuck
      }
    }
    const rotating = chooseRotating(candidates, this.cursor, this.cooldownUntilMs, now)
    if (rotating === undefined) return undefined
    this.cursor = rotating.nextCursor
    this.pin(sessionKey, rotating.account.uid)
    return rotating.account
  }
}
