/**
 * PAGE-DATA 同步枢纽（§3.10.2 / §3.10.3 的宿主侧承载）：把"页面的 store 变化"
 * 变成"下一轮模型请求里真实出现的 PAGE-DATA 块"。
 * The PAGE-DATA sync hub (the host side of §3.10.2/§3.10.3): turns "a page's
 * store changed" into "the PAGE-DATA block that actually appears in the next
 * model request".
 *
 * 三件事，各自单一职责：
 * - **绑定**（`port`）：page-registry 在会话提交后交来已订阅 store 的实时视图
 *   （MessageHost），废弃/回滚时收回——本枢纽是视图的唯一持有者；
 * - **注入**（`attach`）：在页面会话的 agent 作用域上挂 `agent/pre-step`
 *   waterfall 监听（生产等价于 bench 的 preset context 子行）；监听先 `next()`
 *   再追加——page_send 的 followup 已在 claimed 消息里，天然先于本块；
 * - **渲染**（`renderPageData`）：版本门控（无变化零注入）+ 全量快照语义
 *   （"同页 data 以最新一次为准"）+ 截断上限（每集合条数、单块字节、单值
 *   字节），超限标注 `truncated`，绝不无限追加把上下文撑爆。
 * Three single responsibilities:
 * - **bind** (`port`): page-registry hands over the store-subscribed live view
 *   (a MessageHost) after the session commits and takes it back on
 *   deprecation/rollback — this hub is the view's sole owner;
 * - **inject** (`attach`): a `agent/pre-step` waterfall listener on the page
 *   session's agent scope (the production analogue of the bench's preset
 *   context row); it calls `next()` first, so a page_send followup — already
 *   inside the claimed messages — always precedes this block;
 * - **render** (`renderPageData`): version gating (no change → no injection),
 *   snapshot semantics ("the latest block wins for a page"), and truncation
 *   caps (per-collection items, block bytes, single-value bytes) with an
 *   explicit `truncated` marker — the context budget can never blow up.
 *
 * 与 bench（page-sync-bench）的关系：只借鉴"pre-step + 游标"的思路；这里是
 * 生产重写——多会话并存（以 sessionId 为键的独立条目与游标）、随装配卸载、
 * 可回滚、有行为测试。快照而非增量：本通道的追加块会被 loop 落会话日志、
 * 但语义是"以最新一次为准"，且 §3.10.2 明确选了"最新全量快照（不是无限
 * 增量流）"。
 * Relation to the bench (page-sync-bench): only the "pre-step + cursor" idea
 * is borrowed; this is a production rewrite — concurrent sessions (per-
 * sessionId entries and cursors), unload with the assembly, rollback, and
 * behavioral tests. Snapshots over deltas: injected blocks do land in the
 * session log, but the semantics are "latest block wins", and §3.10.2
 * explicitly picks "latest full snapshot, not an unbounded delta stream".
 * @module @veren/app-host/page-sync
 */
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SnapshotNode } from '@veren/prompt-host-messages'
import type { PageDataIdentity, PageDataPort } from '@veren/page-registry'
import type { PageSession } from '@veren/prompt-page'

/** PAGE-DATA 消息源 kind（MessageSourceMap 扩充在 session-port 尾部 declaration merging）
 * / the PAGE-DATA message-source kind (merged in session-port.ts) */
export const PAGE_DATA_MESSAGE_SOURCE = 'page/data' as const

/** 截断上限（§3.10.2 示例值：列表 ≤50 条、单块 ≤4KB）/ the truncation caps (§3.10.2's example values) */
export interface PageDataCaps {
  /** 每个集合最多列出的条目数 / max items listed per collection */
  readonly maxItems: number
  /** 单个 PAGE-DATA 块 data 部分的序列化字节上限 / serialization byte ceiling for one block's data section */
  readonly maxBytes: number
}

/** 缺省上限：50 条 / 4KB（§3.10.2 的示例值，宿主 Config 可覆盖）/ defaults: 50 items / 4KB (host Config overrides) */
export const DEFAULT_PAGE_DATA_CAPS: PageDataCaps = { maxItems: 50, maxBytes: 4096 }

/** 一条已绑定的实时视图：视图 + 身份 + 注入游标 / one bound live view: view + identity + injection cursor */
interface PageDataEntry {
  readonly view: PageSession<never>
  readonly identity: PageDataIdentity
  /** 已注入到的版本号；0 = 尚未注入（首注为全量基线）/ the last injected version; 0 = never injected (first injection is the full baseline) */
  cursor: number
}

/** session-port 需要的注入面 / the injection face the session-port consumes */
export interface PageDataSyncFace {
  /** 在该会话的 agent 作用域挂 pre-step 注入器；返回注销器 / attach the injector to the session's agent scope; returns a disposer */
  attach(sessionId: string, agent: Agent): () => void
  /** 会话废弃/销毁：解绑视图并退订 store（幂等）/ drop the view on deprecation/destroy (idempotent) */
  drop(sessionId: string): void
}

/** 完整枢纽：page-registry 的端口 + session-port 的注入面 + 观测/收尾面 */
export interface PageDataSyncHub extends PageDataSyncFace {
  /** 交给 pageRegistry.bindPorts 的实时视图端口 / the live-view port for pageRegistry.bindPorts */
  readonly port: PageDataPort
  /** 观测面（HMR/测试）：当前绑定的会话数 / observation face: currently bound session count */
  size(): number
  /** 装配卸载：退订全部视图（幂等；之后枢纽不再产出注入）/ assembly unload: unsubscribe every view (idempotent; the hub then injects nothing) */
  dispose(): void
}

export interface PageDataSyncOptions {
  /** 截断上限（宿主 Config 透传）/ the caps (passed through host Config) */
  readonly caps: PageDataCaps
  /** 降级告警出口（渲染失败不毁模型回合）/ the degrade-warn outlet (a render failure must not break the model turn) */
  readonly warn?: (message: string) => void
}

/**
 * 建一个 PAGE-DATA 同步枢纽。多会话并存靠"每 sessionId 一条独立条目（独立
 * 视图 + 独立游标）"保证：agent/pre-step 又经 dsh-scope 的作用域过滤只送达
 * 本会话 agent——两条防线都指向同一条目，互不串台。
 * Create the hub. Concurrent sessions stay isolated because each sessionId
 * owns an independent entry (view + cursor), and `agent/pre-step` reaches only
 * this session's agent through dsh-scope filtering — both lines point at the
 * same single entry.
 */
export function createPageDataSync(options: PageDataSyncOptions): PageDataSyncHub {
  const { caps, warn } = options
  const entries = new Map<string, PageDataEntry>()
  /** 版本门控取块：有变化返回 PAGE-DATA 文本并推进游标 / gated take: text when changed, cursor advanced */
  const takeText = (sessionId: string): string | undefined => {
    const entry = entries.get(sessionId)
    if (entry === undefined || entry.view.host.currentVersion <= entry.cursor) return undefined
    const text = renderPageData(entry.view, entry.identity, caps)
    entry.cursor = entry.view.host.currentVersion
    return text
  }
  const drop = (sessionId: string): void => {
    const entry = entries.get(sessionId)
    if (entry === undefined) return
    entries.delete(sessionId)
    entry.view.unsubscribe()
  }
  return {
    size: () => entries.size,
    drop,
    dispose: () => { for (const sessionId of [...entries.keys()]) drop(sessionId) },
    port: {
      bind: (sessionId, view, identity) => { entries.set(sessionId, { view, identity, cursor: 0 }) },
      unbind: drop,
    },
    attach: (sessionId, agent) => agent.ctx.on('agent/pre-step', async (payload, next) => {
      // waterfall 契约：必须先 next()——page_send 等已认领消息保持在前，本块殿后
      // / waterfall contract: next() first — claimed messages (page_send…) stay ahead
      const decision = await next()
      if (decision.kind !== 'enter' || payload.signal.aborted) return decision
      let text: string | undefined
      try {
        text = takeText(sessionId)
      } catch (error: unknown) {
        // 渲染失败只降级（本块缺席），绝不打断模型回合 / degrade: skip the block, never break the turn
        warn?.(`app-host: PAGE-DATA render failed for session ${sessionId}: ${error instanceof Error ? error.message : String(error)}`)
        return decision
      }
      if (text === undefined) return decision
      return {
        kind: 'enter',
        messages: [...decision.messages, createUserMessage({
          content: [{ type: 'text', text }],
          source: { kind: PAGE_DATA_MESSAGE_SOURCE },
        })],
      }
    }, { prepend: true }),
  }
}

/** PAGE-DATA 块的 data 载荷形状（§3.10.2：页面标识在块头，data 是视图快照）
 * / the block's data payload (§3.10.2: identity rides the header, data is the view snapshot) */
export interface PageDataPayload {
  /** 静态头（页面标题等）/ static headers */
  readonly static: readonly string[]
  /** 字段：path → value / fields: path → value */
  readonly fields: Record<string, unknown>
  /** 集合：path → { total, items }（total 是截断前的真实条数）/ collections with the pre-truncation total */
  readonly collections: Record<string, { readonly total: number; readonly items: readonly unknown[] }>
  /** 任一截断发生时为 true / true when anything was truncated */
  readonly truncated?: true
}

/** 渲染一个 PAGE-DATA 块：头行（页面键 + 规范 URL + 版本）+ data 快照 / render one PAGE-DATA block */
export function renderPageData(view: PageSession<never>, identity: PageDataIdentity, caps: PageDataCaps): string {
  const sync = view.host.renderSince(undefined)
  const nodes = sync.kind === 'snapshot' ? sync.nodes : []
  const header = `PAGE-DATA ${identity.pageKey} ${identity.url} v${view.host.currentVersion}`
  return `${header}\ndata: ${JSON.stringify(collectData(nodes, caps))}`
}

/** 装配中的可变草稿 / the mutable packing draft */
interface PayloadDraft {
  static: string[]
  fields: Record<string, unknown>
  collections: Record<string, { total: number; items: unknown[] }>
}

/** 一段候选区（收集阶段产出，装箱阶段消费）/ one candidate section (collected, then packed) */
interface DataSection {
  /** 把本区写进草稿并返回新草稿（纯函数）/ write this section into the draft, returning a new draft (pure) */
  readonly apply: (draft: PayloadDraft) => PayloadDraft
  /** 本区在收集阶段已被条数上限截断 / this section was already item-capped during collection */
  readonly capped: boolean
}

/** 快照节点 → 候选区序列（集合按 maxItems 预截、total 保留原值）
 * / snapshot nodes → candidate sections (collections pre-capped by maxItems, true total kept) */
function collectSections(nodes: readonly SnapshotNode[], caps: PageDataCaps): DataSection[] {
  const sections: DataSection[] = []
  for (const node of nodes) {
    if (node.kind === 'static') {
      sections.push({
        apply: (draft) => ({ ...draft, static: [...draft.static, node.content] }),
        capped: false,
      })
    } else if (node.kind === 'data') {
      const value = capValue(node.value, caps)
      sections.push({
        apply: (draft) => ({ ...draft, fields: { ...draft.fields, [node.path]: value } }),
        capped: value !== node.value,
      })
    } else {
      const items = node.items.slice(0, caps.maxItems)
      sections.push({
        apply: (draft) => ({
          ...draft,
          collections: { ...draft.collections, [node.path]: { total: node.items.length, items } },
        }),
        capped: items.length < node.items.length,
      })
    }
  }
  return sections
}

/** 单值字节上限兜底：超大值替换为省略标记 / per-value byte guard: oversized values become omission markers */
function capValue(value: unknown, caps: PageDataCaps): unknown {
  const json = JSON.stringify(value) ?? ''
  if (json.length <= Math.max(caps.maxBytes / 2, 256)) return value
  return `…(omitted ${json.length} bytes)`
}

/** 按序装箱候选区，超预算即整区截断（确定性：写不下的区与其后全部丢弃；代价按真实序列化算）
 * / pack sections in order; the first non-fitting section and everything after it are dropped
 * (deterministic; the budget is measured on the real serialization) */
function packSections(sections: readonly DataSection[], caps: PageDataCaps): PageDataPayload {
  let draft: PayloadDraft = { static: [], fields: {}, collections: {} }
  let truncated = false
  for (const section of sections) {
    const candidate = section.apply(draft)
    if (JSON.stringify(candidate).length > caps.maxBytes) return { ...draft, truncated: true }
    draft = candidate
    truncated ||= section.capped
  }
  return truncated ? { ...draft, truncated: true } : draft
}

/** 快照节点 → data 载荷（装箱 + 截断标记）/ snapshot nodes → the data payload (packed, truncation-marked) */
function collectData(nodes: readonly SnapshotNode[], caps: PageDataCaps): PageDataPayload {
  return packSections(collectSections(nodes, caps), caps)
}
