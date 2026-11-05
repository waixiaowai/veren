import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUuid } from '../src/util/random.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('random uuid', () => {
  it('produces a v4 uuid through Web Crypto', () => {
    expect(randomUuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(randomUuid()).not.toBe(randomUuid())
  })

  it('falls back when crypto is unavailable', () => {
    vi.stubGlobal('crypto', undefined)
    const value = randomUuid()
    expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(value).toHaveLength(36)
  })
})
