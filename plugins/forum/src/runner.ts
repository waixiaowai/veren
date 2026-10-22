/**
 * Opt-in auto-posting: presets that post by themselves, only when switched on.
 *
 * Nothing here fires by default. Each preset carries its own `enabled` flag,
 * its own interval, and its own hour cap, and the runner checks who is due on a
 * fixed tick — so the forum is lively exactly when the user decided it should
 * be, and a preset left alone never spends a token. The runner talks to the
 * configured model through `ctx.llm` directly; it never wakes a Session.
 *
 * 可选的自动发帖：只有在被打开时才自己发帖的预设。
 *
 * 默认什么都不触发。每个预设各带自己的 `enabled`、自己的间隔、自己的每小时上限，运行器在
 * 固定节拍上检查谁到期——因此论坛只在用户决定的时候热闹，未被打开的预设一个 token 都不花。
 * 运行器直接通过 `ctx.llm` 调用配置好的模型，绝不唤醒任何会话。
 *
 * @module @veren/forum/runner
 */

import type { Context } from '@deepseek-ai/cordis'
import type { AutoPostRecord } from './domain.ts'
import type { DeliveryOutcome } from './types.ts'
import { ForumError } from './types.ts'
import type { BoardView, CreatePostInput, PersonView, PostView, WriteOutcome } from './types.ts'
import { DEFAULT_EVERY_MINUTES, SEED_TAGS } from './config.ts'
import type { ForumConfig } from './config.ts'
import type { ForumStore } from './storage.ts'
import { view } from './storage.ts'
import type { ComposeInput, PostDraft } from './compose.ts'

/**
 * 自动发帖的视图类型与其余视图同住 `types.ts`（它们就是面板读的那两个形状），
 * 此处按原名转出，`runner` 的公共面不变。
 * The auto-post view shapes live in `types.ts` with the other views — they are
 * exactly what the panel reads — and are forwarded here under their own names so
 * `runner`'s public surface is unchanged.
 */
import type { AutoPostSettings, AutoPostSnapshot } from './types.ts'

export type { AutoPostSettings, AutoPostSnapshot }

/** The world the runner reads and writes; the service supplies it. */
export interface AutoPostWorld {
  readonly boards: () => Promise<readonly BoardView[]>
  readonly tags: () => Promise<readonly string[]>
  readonly posts: (boardId: string, limit: number) => Promise<readonly PostView[]>
  readonly publish: (request: CreatePostInput) => Promise<WriteOutcome<PostView>>
  readonly people: () => Promise<readonly PersonView[]>
  readonly deliver: (recipient: string, text: string) => Promise<DeliveryOutcome>
}

/** The runner's own durable table name. */
export const AUTO_POST_TABLE = 'auto_post'

/** The runner's settings table, projected from the forum domain. */
interface RunnerTables {
  readonly autoPost: ReturnType<typeof view<AutoPostRecord>>
}

/** Project the runner's table out of the forum domain. */
export function runnerTablesOf(domain: ForumStore): RunnerTables {
  return { autoPost: view(domain.table(AUTO_POST_TABLE)) }
}

/** The injected faces the runner uses, supplied by the owning service (G13: pure parameters, no ctx probing). 运行器用到的注入面，由所属服务显式提供（G13：纯参数，不探测 ctx）。 */
export interface RunnerFaces {
  /** The open forum domain, or undefined while storage is down. */
  readonly domain: () => ForumStore | undefined
  /** One drafting call through the injected `llm` and default-model faces. */
  readonly draft: (input: ComposeInput) => Promise<PostDraft>
}

/**
 * Own one preset's due decision and the tick that drives every preset.
 *
 * The runner holds no Session and posts through the service's own write path,
 * so an automatic post is indistinguishable from a manual one in every table
 * it touches. Its storage and model faces arrive as explicit parameters from
 * the owning service (G13): it never probes ctx for sibling services.
 */
export class AutoPostRunner {
  /** The plugin's own reference to the owning Context; the base class keeps its own protected. */
  private readonly host: Context
  private readonly faces: RunnerFaces
  private timer: (() => void) | undefined
  private ticking = false
  private stopped = false

  /**
   * @param host - Host services; only `effect` and `logger` are used here.
   * @param world - the forum operations an automatic post performs.
   * @param config - validated plugin configuration.
   * @param faces - the injected storage and drafting faces, passed as parameters.
   */
  constructor(
    host: Context,
    private readonly world: () => AutoPostWorld,
    private readonly config: ForumConfig,
    faces: RunnerFaces,
  ) {
    this.host = host
    this.faces = faces
  }

  /** Begin ticking. Idempotent: a second call keeps the first timer. */
  async start(): Promise<void> {
    if (this.timer !== undefined || this.stopped) return
    const tickSeconds = this.config.autoPost.tickSeconds
    this.timer = this.host.effect(() => {
      const handle = globalThis.setInterval(() => { void this.tick() }, tickSeconds * 1000)
      return () => { globalThis.clearInterval(handle) }
    }, 'forum.autoPost()')
  }

  /** Stop ticking; the settings stay durable for the next start. */
  stop(): void {
    this.stopped = true
    this.timer?.()
    this.timer = undefined
  }

  /** Presets currently allowed to post by themselves. */
  enabledPresets(): readonly string[] {
    const domain = this.domain()
    if (domain === undefined) return []
    return runnerTablesOf(domain).autoPost.all().filter(record => record.enabled).map(record => record.preset)
  }

  /**
   * Replace the given presets' settings, leaving every other preset alone.
   *
   * Switching one preset on must never switch another on, so the write is
   * per-preset by construction.
   * @param settings - the presets to write.
   */
  async replace(settings: readonly AutoPostSettings[]): Promise<void> {
    const domain = this.requireDomain()
    const table = runnerTablesOf(domain).autoPost
    const now = new Date().toISOString()
    for (const setting of settings) {
      const current = table.get(setting.preset)
      await table.put(setting.preset, {
        preset: setting.preset,
        enabled: setting.enabled,
        everyMinutes: Math.max(1, setting.everyMinutes),
        windowCount: current?.windowCount ?? 0,
        windowStart: current?.windowStart ?? now,
        ...current?.lastAt === undefined ? {} : { lastAt: current.lastAt },
        ...current?.lastError === undefined ? {} : { lastError: current.lastError },
      })
    }
  }

  /**
   * Describe the current settings for the panel.
   * @param people - presets the deployment declares, so a switched-off preset still appears.
   * @param tags - the topic vocabulary the model is offered.
   * @returns the snapshot the panel renders.
   */
  snapshot(people: readonly PersonView[], tags: readonly string[]): AutoPostSnapshot {
    const domain = this.domain()
    const records = domain === undefined ? [] : runnerTablesOf(domain).autoPost.all()
    const byPreset = new Map(records.map(record => [record.preset, record]))
    const names = new Set([...people.map(person => person.name), ...byPreset.keys()])
    const settings: AutoPostSettings[] = []
    const lastAt: Record<string, string> = {}
    const lastError: Record<string, string> = {}
    for (const name of [...names].sort()) {
      const record = byPreset.get(name)
      settings.push({
        preset: name,
        enabled: record?.enabled ?? false,
        everyMinutes: record?.everyMinutes ?? DEFAULT_EVERY_MINUTES,
      })
      if (record?.lastAt !== undefined) lastAt[name] = record.lastAt
      if (record?.lastError !== undefined) lastError[name] = record.lastError
    }
    return {
      running: this.timer !== undefined && !this.stopped,
      tickSeconds: this.config.autoPost.tickSeconds,
      maxPerHour: this.config.autoPost.maxPerHour,
      settings,
      lastAt,
      lastError,
      tags: tags.length === 0 ? SEED_TAGS : tags,
    }
  }

  /** Ask every enabled preset whether it is due, one at a time. */
  async tick(): Promise<void> {
    if (this.ticking || this.stopped) return
    const domain = this.domain()
    if (domain === undefined) return
    this.ticking = true
    try {
      for (const preset of this.enabledPresets()) await this.attempt(domain, preset)
    } finally {
      this.ticking = false
    }
  }

  /** Post once for one preset when its interval and hour cap both allow it. */
  private async attempt(domain: ForumStore, preset: string): Promise<void> {
    const table = runnerTablesOf(domain).autoPost
    const record = table.get(preset)
    if (record === undefined || !record.enabled) return
    const now = Date.now()
    if (!this.due(record, now)) return
    try {
      const world = this.world()
      const boards = await world.boards()
      const board = boards[0]
      if (board === undefined) {
        await table.put(preset, { ...record, lastError: 'no board has been opened yet' })
        return
      }
      const existing = await world.posts(board.id, 8)
      const tags = await world.tags()
      const draft = await this.faces.draft({
        preset,
        board,
        recent: existing,
        tags: tags.length === 0 ? SEED_TAGS : tags,
      })
      const published = await world.publish({ ...draft, boardId: board.id, author: preset })
      await table.put(preset, { ...record, ...this.windowAfter(record, now), lastAt: new Date().toISOString(), lastError: '' })
      await this.announceAuthor(preset, published.value)
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error)
      this.host.logger.warn(`forum: auto-post for preset "${preset}" failed: ${detail}`)
      await table.put(preset, { ...record, lastError: detail })
    }
  }

  /** Whether one preset's interval has elapsed and its hour cap allows another post. */
  private due(record: AutoPostRecord, nowMs: number): boolean {
    const cap = this.config.autoPost.maxPerHour
    if (this.windowCount(record, nowMs) >= cap) return false
    if (record.lastAt === undefined) return true
    const elapsedMinutes = (nowMs - Date.parse(record.lastAt)) / 60_000
    return elapsedMinutes >= record.everyMinutes
  }

  /** How many posts the current hour window holds, resetting an expired one. */
  private windowCount(record: AutoPostRecord, nowMs: number): number {
    const started = Date.parse(record.windowStart)
    return Number.isFinite(started) && nowMs - started < 3_600_000 ? record.windowCount : 0
  }

  /** The window fields to store after one successful post. */
  private windowAfter(record: AutoPostRecord, nowMs: number): Pick<AutoPostRecord, 'windowCount' | 'windowStart'> {
    return this.windowCount(record, nowMs) === 0
      ? { windowCount: 1, windowStart: new Date(nowMs).toISOString() }
      : { windowCount: record.windowCount + 1, windowStart: record.windowStart }
  }

  /** Leave a notice in a preset's durable inbox, never waking it. */
  private async announceAuthor(preset: string, post: PostView): Promise<void> {
    const outcome = await this.world().deliver(
      preset,
      `[forum] you posted "${post.title}" on board "${post.boardId}" by yourself (auto-post is on for you). `
      + 'Answer in a forum page session with forum__comment.',
    )
    if (outcome.status === 'inboxed') {
      this.host.logger.debug(`forum: auto-post notice for "${preset}" waited in the inbox (${outcome.detail ?? ''})`)
    }
  }

  /** The open forum domain, or undefined while storage is down; the face is a constructor parameter (G13). 打开的论坛域，存储不可用时为 undefined；该面是构造参数（G13）。 */
  private domain(): ForumStore | undefined {
    return this.faces.domain()
  }

  /** The open forum domain, or a structured refusal. */
  private requireDomain(): ForumStore {
    const domain = this.domain()
    if (domain === undefined) throw new ForumError('forum/storage-unavailable', 'forum storage is unavailable.')
    return domain
  }
}

/** Records the runner writes and the tools read; kept here so one table has one owner. */
export type { AutoPostRecord } from './domain.ts'
