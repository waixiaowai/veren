import { describe, expect, it } from 'vitest'
import { writeFile, rm, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildCommandArgs, createChildRunner, scrubEnv } from '../src/runner/child-runner.ts'
import { CrawlerManager } from '../src/control/manager.ts'
import type { CrawlerRunRequest } from '../src/control/runner.ts'

// 进程模型集成（design/modules/api.md §1）：真子进程拉起、日志泵、终止。
// Process-model integration (design api.md §1): a real subprocess, the log
// pump, and termination.
const req: CrawlerRunRequest = {
  platform: 'xhs', loginType: 'cookie', crawlerType: 'search', keywords: ['美食'],
  specifiedIds: [], creatorIds: [], enableComments: true, enableSubComments: false,
  enableMedia: false, saveOption: 'jsonl', cookies: 'web_session=1', headless: false,
  maxNotesCount: 20, maxCommentsCount: 10, startPage: 1,
}

describe('scrubEnv', () => {
  it('strips secrets and DSH_* variables case-insensitively', () => {
    const scrubbed = scrubEnv({
      API_KEY: 'k', My_Password: 'p', CLIENT_SECRET: 's', ACCESS_TOKEN: 't',
      DSH_HOME: 'd', dsh_profile: 'p', KEEP_ME: 'yes', PATH: 'x',
    })
    expect(Object.keys(scrubbed).sort()).toEqual(['KEEP_ME', 'PATH'])
  })
})

describe('buildCommandArgs', () => {
  it('points at the cli entry and carries the request as one JSON arg', () => {
    const argv = buildCommandArgs(req)
    expect(argv[0]).toMatch(/cli\.js$/)
    expect(JSON.parse(argv[1] as string)).toMatchObject({ platform: 'xhs', cookies: 'web_session=1' })
  })
})

describe('createChildRunner (real subprocess)', () => {
  it('pumps stdout into the log buffer and completes with exit code 0', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crawler-runner-'))
    const script = join(dir, 'fake-cli.mjs')
    await writeFile(script, "console.log('[INFO] fake crawl started'); console.log('done'); process.exit(0)\n")
    try {
      const manager = new CrawlerManager(createChildRunner(script), { stopTimeoutMs: 200 })
      expect(await manager.start(req)).toMatchObject({ status: 'started' })
      const handleExit = await new Promise<number>((resolve) => {
        const poll = setInterval(() => {
          if (manager.status().status === 'idle') {
            clearInterval(poll)
            resolve(0)
          }
        }, 20)
      })
      expect(handleExit).toBe(0)
      const messages = manager.logs.recent(100).map((entry) => entry.message)
      expect(messages).toContain('fake crawl started')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('stop() terminates a hanging child within the grace window', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'crawler-runner-'))
    const script = join(dir, 'hang.mjs')
    await writeFile(script, 'setInterval(() => {}, 1000)\n')
    try {
      const manager = new CrawlerManager(createChildRunner(script), { stopTimeoutMs: 300 })
      await manager.start(req)
      expect(await manager.stop()).toMatchObject({ status: 'stopped' })
      expect(manager.status().status).toBe('idle')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
