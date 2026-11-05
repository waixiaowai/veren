/**
 * The database assembly: path resolution honors config over the DSH_HOME
 * default, and rows persist across a close/reopen cycle (the durability the
 * gate promises — restarts keep users logged in).
 * 数据库装配：路径解析以配置优先于 DSH_HOME 缺省，且数据行在关闭/重开一轮
 * 后仍在（门禁承诺的持久性——重启后仍保持登录）。
 *
 * @module tests/database
 */

import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openAuthDatabase, resolveDatabaseFile } from '../src/database.js'

describe('database path resolution | 数据库路径解析', () => {
  it('an explicit config path wins over the DSH_HOME default', () => {
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = join('C:', 'some-home')
    try {
      expect(resolveDatabaseFile('C:/custom/auth.db')).toBe('C:/custom/auth.db')
      expect(resolveDatabaseFile('')).toBe(join('C:', 'some-home', 'storages', 'web_login_gate', 'auth.db'))
      expect(resolveDatabaseFile(undefined)).toBe(join('C:', 'some-home', 'storages', 'web_login_gate', 'auth.db'))
    } finally {
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
    }
  })

  it('rows survive a close/reopen cycle on the same file', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'web-login-gate-'))
    const file = join(directory, 'auth.db')
    try {
      const first = await openAuthDatabase(file)
      // 裸仓储插入绕过适配器默认值，时间列显式给出。
      // A raw repository insert bypasses adapter defaults; give the time columns.
      await first.getRepository('user').insert({
        id: 'user-1',
        name: 'Ada',
        email: 'ada@example.com',
        emailVerified: false,
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      await first.destroy()

      const second = await openAuthDatabase(file)
      const row = await second.getRepository('user').findOneBy({ email: 'ada@example.com' })
      expect(row?.name).toBe('Ada')
      await second.destroy()
    } finally {
      // Windows 会在关闭后短暂锁定 sqlite 文件：清理失败不作为用例失败。
      // Windows keeps the sqlite file locked briefly after close: cleanup
      // failure never fails the case.
      await rm(directory, { recursive: true, force: true }).catch(() => undefined)
    }
  })
})
