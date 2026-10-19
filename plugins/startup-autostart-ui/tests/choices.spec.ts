/**
 * The detail form's dropdown sources.
 *
 * Presets and models are read from the Host's own Remote namespaces, filtered
 * and flattened into plain options, and shared by every form on the page. The
 * specs pin the visible mapping (broken presets never offered, "provider /
 * model" labels) and the same invalidation and teardown rules as the catalog.
 *
 * 详情表单下拉的选项来源。
 *
 * 预设与模型读取自宿主自身的 Remote 命名空间，被筛选、展平为普通选项，并由页面上的
 * 每个表单共享。测试钉住可见映射（损坏的预设绝不出现在选项中、"提供方 / 模型" 标签）
 * 以及和目录相同的失效与拆卸规则。
 */

import { describe, expect, it, vi } from 'vitest'
import { createStartupChoices } from '../src/client/choices.ts'
import type { StartupChoicesDeps } from '../src/client/choices.ts'

/** The preset read's successful value. 预设读取的成功值。 */
function presetsOk(): Awaited<ReturnType<StartupChoicesDeps['listPresets']>> {
  return {
    ok: true,
    value: {
      presets: [
        { id: 'writer', name: 'Writer', description: 'Long-form drafts' },
        { id: 'broken-one', name: 'Broken', broken: 'missing package' },
        { id: 'coder' },
      ],
    },
  }
}

/** The model read's successful value. 模型读取的成功值。 */
function modelsOk(): Awaited<ReturnType<StartupChoicesDeps['listModels']>> {
  return {
    ok: true,
    value: {
      groups: [
        { id: 'deepseek', name: 'DeepSeek', models: [{ id: 'v4-flash', name: 'V4 Flash' }] },
        { id: 'local', name: 'Local', models: [{ id: 'tiny', name: 'Tiny' }, { id: 'large', name: 'Large' }] },
      ],
    },
  }
}

/** Let queued promise chains settle. 让排队的 Promise 链落定。 */
function flush(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

/** Choices whose reads and invalidation source the test drives. 由测试驱动读取与失效来源的选项源。 */
function bench(overrides: Partial<StartupChoicesDeps> = {}) {
  const invalidate = new Set<() => void>()
  const disposeInvalidate = vi.fn()
  const deps: StartupChoicesDeps = {
    listPresets: vi.fn(async () => presetsOk()),
    listModels: vi.fn(async () => modelsOk()),
    subscribeInvalidate(listener) {
      invalidate.add(listener)
      return () => {
        invalidate.delete(listener)
        disposeInvalidate()
      }
    },
    ...overrides,
  }
  return {
    deps,
    choices: createStartupChoices(deps),
    emitInvalidate(): void { for (const listener of [...invalidate]) listener() },
    subscriberCount: () => invalidate.size,
    disposeInvalidate,
  }
}

describe('startup choices / 启动项选项', () => {
  it('offers healthy presets in roster order and never a broken one', async () => {
    const { choices } = bench()
    const off = choices.source.subscribe(() => {})
    await flush()

    expect(choices.source.getSnapshot().presets).toEqual([
      { value: 'writer', label: 'Writer', hint: 'Long-form drafts' },
      { value: 'coder', label: 'coder' },
    ])
    expect(choices.source.getSnapshot().status).toBe('ready')
    off()
  })

  it('flattens every model group into "group / model" options', async () => {
    const { choices } = bench()
    const off = choices.source.subscribe(() => {})
    await flush()

    expect(choices.source.getSnapshot().models).toEqual([
      { provider: 'deepseek', model: 'v4-flash', label: 'DeepSeek / V4 Flash' },
      { provider: 'local', model: 'tiny', label: 'Local / Tiny' },
      { provider: 'local', model: 'large', label: 'Local / Large' },
    ])
    off()
  })

  it('issues both reads once and republishes loading before them', async () => {
    const listPresets = vi.fn(async () => presetsOk())
    const listModels = vi.fn(async () => modelsOk())
    const { choices } = bench({ listPresets, listModels })
    const statuses: string[] = []
    const off = choices.source.subscribe(() => statuses.push(choices.source.getSnapshot().status))
    const offSecond = choices.source.subscribe(() => {})
    await flush()

    expect(listPresets).toHaveBeenCalledTimes(1)
    expect(listModels).toHaveBeenCalledTimes(1)
    expect(statuses).toEqual(['loading', 'ready'])
    off()
    offSecond()
  })

  it('keeps a refused preset read or model read as one error state', async () => {
    const refused = vi.fn(async () => ({ ok: false as const, error: { code: 'x', message: 'no' } }))
    const { choices } = bench({ listModels: refused })
    const off = choices.source.subscribe(() => {})
    await flush()

    expect(choices.source.getSnapshot()).toMatchObject({ status: 'error', presets: [], models: [] })
    off()
  })

  it('re-reads both sources when the shared invalidation fires', async () => {
    const listPresets = vi.fn(async () => presetsOk())
    const listModels = vi.fn(async () => modelsOk())
    const { choices, emitInvalidate } = bench({ listPresets, listModels })
    const off = choices.source.subscribe(() => {})
    await flush()

    emitInvalidate()
    await flush()

    expect(listPresets).toHaveBeenCalledTimes(2)
    expect(listModels).toHaveBeenCalledTimes(2)
    off()
  })

  it('resets the options and releases the invalidation on the last unsubscribe', async () => {
    const { choices, subscriberCount, disposeInvalidate } = bench()
    const off = choices.source.subscribe(() => {})
    await flush()
    expect(choices.source.getSnapshot().presets.length).toBeGreaterThan(0)

    off()

    expect(subscriberCount()).toBe(0)
    expect(disposeInvalidate).toHaveBeenCalledTimes(1)
    expect(choices.source.getSnapshot()).toEqual({ presets: [], models: [], status: 'loading' })
  })

  it('discards a read that resolves after the last subscriber left', async () => {
    let resolvePresets: (value: Awaited<ReturnType<StartupChoicesDeps['listPresets']>>) => void = () => {}
    const listPresets = vi.fn(() => new Promise<Awaited<ReturnType<StartupChoicesDeps['listPresets']>>>((resolve) => {
      resolvePresets = resolve
    }))
    const { choices } = bench({ listPresets })
    const off = choices.source.subscribe(() => {})
    off()

    resolvePresets(presetsOk())
    await flush()

    expect(choices.source.getSnapshot()).toEqual({ presets: [], models: [], status: 'loading' })
  })
})
