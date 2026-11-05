/**
 * The page's dictionaries, against the typed key union.
 *
 * 页面的词典，对照类型化的键联合。
 */

import { describe, expect, it } from 'vitest'
import { NS, en, zh, type MailKey } from '../src/client/locales.ts'

describe('mail-ui locales', () => {
  it('uses one namespace', () => {
    expect(NS).toBe('mail-ui')
  })

  it('covers the same key set in both locales', () => {
    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
  })

  it('has no empty copy', () => {
    for (const key of Object.keys(zh) as MailKey[]) {
      expect(zh[key].length).toBeGreaterThan(0)
      expect(en[key].length).toBeGreaterThan(0)
    }
  })

  it('names every tab and every state', () => {
    const required: MailKey[] = ['panel', 'tabInbox', 'tabActivity', 'read', 'unread', 'archived']
    for (const key of required) {
      expect(zh[key]).toBeTruthy()
      expect(en[key]).toBeTruthy()
    }
  })
})
