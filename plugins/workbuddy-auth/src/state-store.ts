/**
 * 账号仓：全部账号状态（凭据/冷却/停用/探测四类）住在宿主凭据缝的**一张
 * grant 记录**里，一切写经 `modifyRecord`（跨进程串行化的读-改-写）。
 * The account store: all account state (credential / cooldown / disabled /
 * probe — four classes) lives in **one grant record** on the host credential
 * seam; every write goes through `modifyRecord` (a cross-process serialized
 * read-modify-write).
 *
 * 为什么是宿主缝而非插件自有文件：
 * - 缝的文档原文："Exclusion holds across processes … which is what makes a
 *   token refresh safe"——刷新单飞的跨进程半边免费获得；
 * - Models 页/凭据 UI 只认 credentials seam 的记录；
 * - 原子写（writeFileAtomic + 文件锁 + 0600）由宿主保证。
 * 四类同住一张文档 ⇒ 登出的"四类清除"由构造保证原子完成。
 * Why the seam over plugin-owned files: the seam's own doc says the exclusion
 * holds across processes ("which is what makes a token refresh safe") — the
 * cross-process half of refresh single-flight comes free; the Models page only
 * reads credentials-seam records; atomic writes are the host's guarantee. Four
 * classes in one document ⇒ logout's four-class purge is atomic by construction.
 *
 * @module @veren/workbuddy-auth/state-store
 */
import type { Context } from '@deepseek-ai/cordis'
import { credentialKey, type CredentialRecord } from '@deepseek-ai/dsh-credentials'
import {
  RegionPool, callRefresh, needsRefresh, regionOfDomain,
  type LoginResult, type ProbeOutcome, type RefreshableCredential,
  type UpstreamErrorKind, type WorkBuddyRegion, type WorkbuddyAccountEntry,
  type WorkbuddyStateDocument, emptyStateDocument, parseStateDocument,
  withAccountEntry, withCooldown, withDisabled, withoutAccount,
  withProbeObservation, cooldownForKind,
} from '@veren/workbuddy-protocol'
import { NotSignedInError } from '@veren/workbuddy-protocol'

/** 本插件占用的凭据记录地址：`workbuddy-auth/accounts`。 */
/** This plugin's credential-record address: `workbuddy-auth/accounts`. */
export const WORKBUDDY_RECORD = credentialKey('workbuddy-auth', 'accounts')

/** 单一路由 id：区域随凭据走（结构性裁定，不改）。The single route id: region rides with the credential (structural ruling, not revisited). */
export const WORKBUDDY_PROVIDER = 'workbuddy'

/** 授权流的两方法 id（区域选择面）。The flow's two method ids (the region chooser). */
export const METHOD_CN = 'device-code-cn'
export const METHOD_GLOBAL = 'device-code-global'

/** 刷新一次的单飞结果。One refresh's single-flight outcome. */
export type RefreshOutcome =
  | { readonly status: 'refreshed' | 'not-needed'; readonly entry: WorkbuddyAccountEntry }
  | { readonly status: 'failed'; readonly reason: string }

/** 账号仓的协作面（测试注入）。The store's collaborators (test injection). */
export interface WorkbuddyAccountsDeps {
  readonly now?: () => number
  /** 线路刷新替换点；生产用 callRefresh。The wire-refresh seam; production uses callRefresh. */
  readonly refresh?: typeof callRefresh
}

/**
 * 账号仓。resolve() 是请求路径的入口：区域池（粘性 + 轮换 + 冷却）选号 →
 * 惰性刷新（进程内单飞 × 缝的跨进程锁）→ 返回最新凭据。
 * The store. resolve() is the request path: the region pool (sticky + rotating
 * + cooldown) picks → lazy refresh (in-process single flight × the seam's
 * cross-process lock) → the freshest credential.
 */
export class WorkbuddyAccounts {
  private readonly now: () => number
  private readonly refresh: typeof callRefresh
  /** 区域池（内存态：游标/粘性/冷却视图）。Region pools (in-memory cursor/affinity/cooldown view). */
  private readonly pools = new Map<WorkBuddyRegion, PoolWithSnapshot>()
  /** 进程内刷新单飞表。The in-process refresh single-flight table. */
  private readonly refreshing = new Map<string, Promise<RefreshOutcome>>()

  constructor(private readonly ctx: Context, deps: WorkbuddyAccountsDeps = {}) {
    this.now = deps.now ?? Date.now
    this.refresh = deps.refresh ?? callRefresh
  }

  /** 读当前文档；未登录/损坏 = 空文档（不猜）。Reads the document; signed-out or damaged = empty (never guessed). */
  async read(): Promise<WorkbuddyStateDocument> {
    const record = await this.ctx.credentials.readRecord(WORKBUDDY_RECORD)
    if (record?.kind !== 'grant') return emptyStateDocument()
    return parseStateDocument(record.payload) ?? emptyStateDocument()
  }

  /** 在缝的串行化内做一次读-改-写（mutate 可异步——锁跨 await 持有）。 */
  /** One read-modify-write inside the seam's serialization (async mutate allowed — the lock spans the await). */
  async modify(mutate: (document: WorkbuddyStateDocument) => WorkbuddyStateDocument | Promise<WorkbuddyStateDocument>): Promise<WorkbuddyStateDocument> {
    let result = emptyStateDocument()
    await this.ctx.credentials.modifyRecord(WORKBUDDY_RECORD, async (current: CredentialRecord | undefined) => {
      const document = current?.kind === 'grant' ? (parseStateDocument(current.payload) ?? emptyStateDocument()) : emptyStateDocument()
      result = await mutate(document)
      return { kind: 'grant', payload: result }
    })
    return result
  }

  /** 一个区域的池（懒建，快照由调用方在 resolve 前原地刷新——供给闭包读 holder 本体，引用替换无效）。 */
  /** One region's pool (lazily built; the caller refreshes the snapshot in place — the supplier closure reads the holder itself, so reference swaps are inert). */
  private poolFor(region: WorkBuddyRegion): PoolWithSnapshot {
    let holder = this.pools.get(region)
    if (holder === undefined) {
      const built: PoolWithSnapshot = { snapshot: [], pool: undefined as unknown as RegionPool<{ uid: string; expiresAtMs: number }> }
      built.pool = new RegionPool(() => built.snapshot, this.now)
      holder = built
      this.pools.set(region, holder)
    }
    return holder
  }

  /**
   * 选号并保证凭据新鲜。粘性不粘坏账号（RegionPool 内保证）；刷新单飞：
   * 同 uid 并发 N 调用共享一个请求（第二个进程经缝锁重读已提交的新令牌）。
   * Picks and freshness-guarantees a credential. Stickiness never sticks to a
   * bad account (inside RegionPool); refreshes single-flight: N concurrent
   * callers share one request (a second process re-reads the committed token
   * under the seam lock).
   */
  async resolve(region: WorkBuddyRegion, sessionKey: string | undefined): Promise<WorkbuddyAccountEntry> {
    const document = await this.read()
    const now = this.now()
    const disabled = new Set(document.disabled)
    const accounts = document.accounts
      .filter(entry => regionOfDomain(entry.domain) === region && !disabled.has(entry.uid))
      .map(entry => ({ uid: entry.uid, expiresAtMs: entry.expiresAtMs }))
    const holder = this.poolFor(region)
    holder.snapshot.length = 0
    holder.snapshot.push(...accounts)
    for (const [uid, until] of Object.entries(document.cooldowns)) holder.pool.seedCooldown(uid, until)
    const chosen = holder.pool.resolve(sessionKey)
    if (chosen === undefined) {
      throw new NotSignedInError(`尚未登录 WorkBuddy ${region === 'global' ? 'AI（国际版）' : '（国内版）'}。请先在设置 → 模型页完成授权登录。`)
    }
    const entry = document.accounts.find(candidate => candidate.uid === chosen.uid)
    if (entry === undefined) throw new NotSignedInError()
    if (!needsRefresh(toRefreshable(entry), now)) return entry
    const outcome = await this.refreshEntry(entry.uid)
    if (outcome.status === 'failed') {
      // 刷新失败按登录失效处理：重试无益，用户动作与未登录相同。
      // A failed refresh is a dead sign-in: retrying cannot help, the user's action equals signing in again.
      throw new NotSignedInError(`账号登录已失效，请重新授权登录。原因：${outcome.reason}`)
    }
    const fresh = await this.read()
    return fresh.accounts.find(candidate => candidate.uid === entry.uid) ?? outcome.entry
  }

  /** 惰性刷新一个账号（单飞）。Lazy-refreshes one account (single flight). */
  async refreshEntry(uid: string): Promise<RefreshOutcome> {
    const inFlight = this.refreshing.get(uid)
    if (inFlight !== undefined) return inFlight
    const run = (async (): Promise<RefreshOutcome> => {
      // 修改在缝锁内执行且锁跨网络调用：第二进程在锁内重读已提交的新令牌，
      // needsRefresh 已为 false，自然跳过刷新——不会重放已消费的轮换令牌。
      // The mutation runs inside the seam lock and the lock spans the network
      // call: a second process re-reads the committed token inside the lock and
      // skips its refresh — the spent rotating token is never replayed.
      let outcome: RefreshOutcome = { status: 'failed', reason: 'unreachable' }
      await this.modify(async (document) => {
        const stored = document.accounts.find(candidate => candidate.uid === uid)
        if (stored === undefined) return document
        if (!needsRefresh(toRefreshable(stored), this.now())) {
          outcome = { status: 'not-needed', entry: stored }
          return document
        }
        const result = await this.refresh(toRefreshable(stored))
        if (!result.ok) {
          outcome = { status: 'failed', reason: result.message }
          return document
        }
        const refreshed: WorkbuddyAccountEntry = {
          ...stored,
          accessToken: result.tokens.accessToken,
          refreshToken: result.tokens.refreshToken ?? stored.refreshToken,
          expiresAtMs: result.tokens.expiresInSec !== undefined
            ? this.now() + result.tokens.expiresInSec * 1000
            : stored.expiresAtMs,
          ...(result.tokens.domain !== undefined ? { domain: result.tokens.domain } : {}),
        }
        outcome = { status: 'refreshed', entry: refreshed }
        return withAccountEntry(document, refreshed)
      })
      return outcome
    })()
    this.refreshing.set(uid, run)
    try {
      return await run
    } finally {
      this.refreshing.delete(uid)
    }
  }

  /** 记一笔失败冷却（分类学定时长；不冷却的类别无操作）。池的内存视图由下次 resolve 从文档回灌。 */
  /** Notes one failure cooldown (the taxonomy sets the duration; non-cooling kinds no-op). The pool's in-memory view re-seeds from the document on the next resolve. */
  async noteFailure(uid: string, kind: UpstreamErrorKind): Promise<void> {
    const untilMs = cooldownForKind(kind)
    if (untilMs === undefined) return
    await this.modify(document => withCooldown(document, uid, this.now() + untilMs))
  }

  /** 登录产物落位（授权流的 commit 前由它合成新文档）。Merges a login result (the flow composes the document before commit). */
  mergeLogin(document: WorkbuddyStateDocument, result: LoginResult, now: number): WorkbuddyStateDocument {
    const entry: WorkbuddyAccountEntry = {
      accessToken: result.token.accessToken,
      refreshToken: result.token.refreshToken,
      expiresAtMs: now + result.token.expiresIn * 1000,
      domain: result.token.domain,
      uid: result.account.uid,
      ...(result.account.enterpriseId !== '' ? { enterpriseId: result.account.enterpriseId } : {}),
      ...(result.account.nickname !== '' ? { nickname: result.account.nickname } : {}),
    }
    return withAccountEntry(document, entry)
  }

  /** 登出：四类痕迹一次删净（单文档构造上原子）。Signs out: four classes erased at once (atomic by the single-document construction). */
  async remove(uid: string): Promise<void> {
    await this.modify(document => withoutAccount(document, uid))
    this.pools.get('cn')?.pool.forget(uid)
    this.pools.get('global')?.pool.forget(uid)
  }

  /** 启停一个账号（可逆；凭据与状态保留）。Toggles one account (reversible; credential and state kept). */
  async setDisabled(uid: string, disabled: boolean): Promise<void> {
    await this.modify(document => withDisabled(document, uid, disabled))
  }

  /** 存一条探测观测。Archives one probe observation. */
  async noteProbe(uid: string, region: WorkBuddyRegion, model: string, outcome: ProbeOutcome): Promise<void> {
    await this.modify(document => withProbeObservation(document, uid, region, model, {
      validation: outcome.validation,
      efforts: [...outcome.efforts],
      observedAtMs: this.now(),
    }))
  }
}

/** 池与其快照的配对。A pool paired with its snapshot. */
interface PoolWithSnapshot {
  snapshot: { uid: string; expiresAtMs: number }[]
  pool: RegionPool<{ uid: string; expiresAtMs: number }>
}

/** 条目 → 协议库的可刷新凭据视图（region 按 domain 重算）。 */
/** Entry → the protocol's refreshable credential view (region recomputed from the domain). */
function toRefreshable(entry: WorkbuddyAccountEntry): RefreshableCredential {
  return {
    accessToken: entry.accessToken,
    refreshToken: entry.refreshToken,
    expiresAtMs: entry.expiresAtMs,
    domain: entry.domain,
    uid: entry.uid,
    ...(entry.enterpriseId === undefined ? {} : { enterpriseId: entry.enterpriseId }),
    region: regionOfDomain(entry.domain),
  }
}
