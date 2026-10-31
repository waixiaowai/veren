import { describe, expect, it } from 'vitest'
import { parseConfig } from './intake-helpers.ts'

describe('intake plugin config', () => {
  it('defaults the switch on with the documented bounds', () => {
    expect(parseConfig({}).strangerIntake).toEqual({
      enabled: true,
      replyWindowMs: 120_000,
      maxAsksPerHour: 10,
      minAskIntervalMs: 10_000,
    })
  })

  it('lets the operator switch it off', () => {
    expect(parseConfig({ strangerIntake: { enabled: false } }).strangerIntake.enabled).toBe(false)
  })
})
