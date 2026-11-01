/**
 * Shared fixtures for the effects specs: a deterministic clock, a health
 * sink that records every snapshot, and a deferred promise. The core never
 * sets timers — time only moves when a test advances the clock and calls
 * `idle()`, so every spec is fully deterministic.
 *
 * 效果测试的共享夹具：确定性时钟、记录每份快照的健康 sink、可手工放行的 deferred。
 * 核从不设定时器——时间只在测试拨动时钟并调用 `idle()` 时前进，因此每条用例完全确定。
 *
 * @module tests/helpers
 */

import type { EffectHealthSink, EffectHealthSnapshot } from '../src/index.ts'

/** A fake clock the test advances by hand; mirrors the official `now` injection. */
export interface FakeClock {
  readonly now: () => number
  readonly advance: (milliseconds: number) => void
}

export function fakeClock(): FakeClock {
  let value = 1_760_000_000_000
  return {
    now: () => value,
    advance: milliseconds => {
      value += milliseconds
    },
  }
}

/** Records every snapshot per kind so specs assert the latest report. */
export interface RecordingHealth extends EffectHealthSink {
  readonly entries: Map<string, EffectHealthSnapshot[]>
  latest(kind: string): EffectHealthSnapshot | undefined
}

export function recordingHealth(): RecordingHealth {
  const entries = new Map<string, EffectHealthSnapshot[]>()
  return {
    entries,
    latest: kind => entries.get(kind)?.at(-1),
    set: (kind, snapshot) => {
      const list = entries.get(kind) ?? []
      list.push(snapshot)
      entries.set(kind, list)
    },
  }
}

/** A promise a test resolves by hand, for holding attempts mid-flight. */
export interface Deferred {
  readonly promise: Promise<void>
  readonly resolve: () => void
}

export function deferred(): Deferred {
  let release!: () => void
  const promise = new Promise<void>(done => {
    release = done
  })
  return { promise, resolve: release }
}
