import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LOGIN_STATE_FILE, persistLoginState, summarizeLoginState } from '../src/auth/persist.ts'

// 登录态持久化（design/modules/auth.md §5）：只落元数据，凭证值永不进文件。
// Login-state persistence (auth.md §5): metadata only; credential values
// never reach a file.
describe('persistLoginState', () => {
  it('writes platform metadata and cookie names but never cookie values', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crawler-login-'))
    try {
      await persistLoginState({
        platform: 'wb',
        cookieSnapshot: [{ domain: '.weibo.cn', name: 'SUB', value: 'top-secret' }],
        persistedDir: join(dir, 'nested', 'profile'),
      })
      const body = await readFile(join(dir, 'nested', 'profile', LOGIN_STATE_FILE), 'utf8')
      expect(body).toContain('"platform": "wb"')
      expect(body).toContain('"SUB"')
      expect(body).not.toContain('top-secret')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('summarizes with an injectable clock', () => {
    const summary = summarizeLoginState(
      { platform: 'wb', cookieSnapshot: [], persistedDir: './browser-data/wb_user_data_dir' },
      new Date('2026-11-04T10:00:00.000Z'),
    )
    expect(summary).toEqual({
      platform: 'wb',
      persistedDir: './browser-data/wb_user_data_dir',
      loggedInAt: '2026-11-04T10:00:00.000Z',
      cookieNames: [],
    })
  })
})
