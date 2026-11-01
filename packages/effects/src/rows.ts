/**
 * The effects core's storage port and row contract.
 *
 * The row is field-for-field the official dsh-superagent `effect` table row
 * (MIT, read-only reference at `deepseek/dsh-superagent/src/app/effects.ts`):
 * `kind, key, value, seq, generation, attempts, due, error`. The port exists
 * because the official core reads SQLite synchronously while our hosts
 * persist through async key/value media — the core serializes every mutation
 * on one internal chain, so the port only needs load/list/put/delete.
 *
 * 效果核的存储端口与行契约。行字段与官方 dsh-superagent 的 `effect` 表逐字段一致
 * （MIT，只读参照 `deepseek/dsh-superagent/src/app/effects.ts`）：
 * `kind, key, value, seq, generation, attempts, due, error`。之所以要端口，是因为官方核
 * 同步读 SQLite，而我们的宿主走异步键值介质——核把所有变更串在一条内部链上，端口只需
 * load/list/put/delete 四个原语。
 *
 * @module @veren/effects/rows
 */

/** Payload map constraint: one entry per effect kind. / 载荷映射约束：每种 kind 一条 */
export interface EffectPayloadMap {
  readonly [kind: string]: unknown
}

/**
 * One durable effect row; the queue holds at most one per `kind + key`.
 * 一条持久化效果行；每个 `kind + key` 至多一行。
 */
export interface EffectRow {
  /** Effect kind, e.g. `deliver`. */
  readonly kind: string
  /** Key within the kind, e.g. the notice id. */
  readonly key: string
  /** JSON-encoded payload. */
  readonly value: string
  /** Queue position; monotonic across restarts so rows resume in order. */
  readonly seq: number
  /** Bumped on every re-enqueue so a running attempt never clobbers a newer payload. */
  readonly generation: number
  /** Failed attempts of the current payload; a re-enqueue resets it to 0. */
  readonly attempts: number
  /** Earliest dispatch instant (epoch milliseconds). */
  readonly due: number
  /** Why the last attempt failed; empty while the row never failed. */
  readonly error: string
}

/**
 * 行的介质键：`<kind>` + 分隔符 + `<key>`。分隔符用 NUL 控制字符（经
 * `String.fromCodePoint` 构造，避免源码里裸控制字节），因为 kind 与 key 都可能含
 * 斜杠、点等任意可见字符，不能选可见分隔符。
 * / The medium key of one row: `<kind>` + separator + `<key>`. The separator
 * is the NUL control character (built via `String.fromCodePoint`, keeping the
 * source free of raw control bytes) because both kind and key may contain any
 * printable character.
 */
const KEY_SEPARATOR = String.fromCodePoint(0)

export function effectRowKey(kind: string, key: string): string {
  return `${kind}${KEY_SEPARATOR}${key}`
}

/**
 * The storage port every backend implements. `list` is a synchronous
 * in-memory snapshot (both shipped backends keep the medium in memory and
 * write through asynchronously), so it may briefly lag a queued write; the
 * core never treats a lagging read as authoritative — every outcome write
 * re-checks the row it is settling.
 * / 每个后端都要实现的存储端口。`list` 是同步的内存快照（两个内置后端都把介质放在
 * 内存、异步落盘），因此可能短暂滞后于排队中的写入；核从不把滞后的读当权威——每次
 * 写回都会重新核对要结算的行。
 */
export interface EffectStorage {
  /** Durable rows to resume; awaited once when the queue opens. */
  load(): Promise<readonly EffectRow[]>
  /** Snapshot of waiting rows, optionally one kind; any order (the core sorts by `seq`). */
  list(kind?: string): readonly EffectRow[]
  /** Upsert one row durably. */
  put(row: EffectRow): Promise<void>
  /** Delete one row durably; `true` when it existed. */
  delete(kind: string, key: string): Promise<boolean>
}

/**
 * Per-kind handler options; every field defaults exactly like the official
 * queue (limit 1, retry 2s doubling to 60s, unordered, not quiet).
 * / 每种 kind 的处理器选项；各字段的默认值与官方队列完全一致（并发 1、重试 2s 起指数
 * 退避到 60s、无序、不静默）。
 */
export interface HandlerOptions {
  /** How many may run at once right now; 0 holds the kind. */
  limit?: () => number
  /** Initial and maximum retry backoff, in milliseconds. */
  retry?: readonly [number, number]
  /** One at a time in queue order; a failed row holds back later rows of the kind. */
  ordered?: boolean
  /** Repeated failures never mark the kind's health `error`. */
  quiet?: boolean
}
