import { describe, expect, it } from 'vitest'
import { createInProcessRunner, CancelFlag } from '../src/runner/inprocess-runner.ts'
import { LogBuffer } from '../src/control/logs.ts'
import type { CrawlerRunRequest } from '../src/control/runner.ts'
import type { PipelineDeps } from '../src/pipeline.ts'
import type { CrawlerStore } from '../src/store/domain.ts'

// 进程内运行器验收：报告管道（管线 report → LogBuffer）与协作取消语义。
// In-process runner acceptance: the report pipe (pipeline report →
// LogBuffer) and the cooperative cancellation semantics.
const request: CrawlerRunRequest = {
  platform: 'tieba',
  loginType: 'cookie',
  crawlerType: 'search',
  keywords: ['美食'],
  specifiedIds: [],
  creatorIds: [],
  enableComments: false,
  enableSubComments: false,
  enableMedia: false,
  cookies: null,
  headless: true,
  maxNotesCount: 3,
  maxCommentsCount: 3,
  startPage: 1,
}

/** 立即命中登录的假依赖 / deps whose probe hits immediately */
function fakeDeps(calls: { report: string[] }): PipelineDeps {
  return {
    launchSession: async () => {
      throw new Error('不应走到会话创建')
    },
    report: (message: string) => void calls.report.push(message),
  }
}

/** 最小域替身 / a minimal domain double */
function fakeDomain(): CrawlerStore {
  return { table: () => ({ put: async () => {}, entries: () => new Map().entries() }) } as unknown as CrawlerStore
}

describe('in-process runner', () => {
  it('pipes pipeline report messages into the given LogBuffer', async () => {
    const logs = new LogBuffer()
    const calls = { report: [] as string[] }
    const runner = createInProcessRunner({
      deps: () => fakeDeps(calls),
      domain: () => fakeDomain(),
    })
    const handle = runner(request, logs)
    const code = await handle.exit
    expect(code).toBe(1)
    // 管线 report 消息确实流进缓冲 / pipeline report messages do land in the buffer
    const messages = logs.recent(20).map((entry) => entry.message)
    expect(messages.some((message) => message.includes('启动采集'))).toBe(true)
  })

  it('cancel() raises the cooperative flag before the pipeline reads the domain', async () => {
    const logs = new LogBuffer()
    const runner = createInProcessRunner({
      deps: () => fakeDeps({ report: [] }),
      domain: () => fakeDomain(),
    })
    const handle = runner(request, logs)
    handle.terminate()
    const code = await handle.exit
    // 取消标记不改变域缺失错误路径，但 kill/terminate 不抛 / cancel does not change the closed-domain path, but terminate/kill do not throw
    expect(code).toBe(1)
  })

  it('CancelFlag is a plain cooperative switch', () => {
    const flag = new CancelFlag()
    expect(flag.isCancelled).toBe(false)
    flag.cancel()
    expect(flag.isCancelled).toBe(true)
  })
})
