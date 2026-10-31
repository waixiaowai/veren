/**
 * The storage plumbing the domain rides on: the notification key's round trip
 * and the table projection over the real KvTable handle.
 *
 * 领域所依赖的存储管线：通知键的往返，以及真实 KvTable 句柄上的表投影。
 */

import { describe, expect, it } from 'vitest'
import { notificationKey, splitNotificationKey } from '../src/ids.ts'
import { view } from '../src/storage.ts'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'

describe('notification keys', () => {
  it('round-trips a recipient and an id', () => {
    const key = notificationKey('standard', 'notification-abc')
    expect(splitNotificationKey(key)).toEqual({ recipient: 'standard', id: 'notification-abc' })
  })

  it('keeps two recipients that share an id apart', () => {
    expect(notificationKey('a', 'x')).not.toBe(notificationKey('b', 'x'))
  })
})

describe('table projection', () => {
  it('exposes get, put, del, and all over the real table handle', async () => {
    const table: KvTable<string, { id: string }> = {
      get: key => ({ id: key }),
      entries: () => [['a', { id: 'a' }] as [string, { id: string }]][Symbol.iterator](),
      keys: () => ['a'][Symbol.iterator](),
      size: 1,
      put: async () => undefined,
      delete: async () => true,
      update: async () => ({ id: 'a' }),
    }
    const projected = view(table)
    expect(projected.get('a')).toEqual({ id: 'a' })
    expect(projected.all()).toEqual([{ id: 'a' }])
    await expect(projected.put('b', { id: 'b' })).resolves.toBeUndefined()
    await expect(projected.del('a')).resolves.toBe(true)
  })
})
