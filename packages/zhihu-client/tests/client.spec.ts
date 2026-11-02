/**
 * 官方客户端的单测：鉴权头、时间戳头、本地日预算、平台配额闸门、业务码分类。
 * Unit tests for the official client: the auth header, the timestamp header,
 * the local daily budget, the platform quota gate, and business-code mapping.
 */
import { describe, expect, it } from 'vitest'
import { OfficialZhihuClient } from '../src/official/client.ts'
import { AUTH_HEADER, ENDPOINT_PATHS, EndpointName, TIMESTAMP_HEADER } from '../src/official/endpoints.ts'
import { ZhihuError, ZhihuErrorCode } from '../src/errors.ts'
import { FakeFetch, jsonAnswer } from './support/fake-fetch.ts'

/** 一个固定的钟面（让时间戳头可断言）/ a fixed clock (so the timestamp header is assertable) */
const FIXED_NOW = 1_762_000_000_000

/** 造一个走假 fetch 的客户端 / a client over the fake fetch */
function clientWith(fake: FakeFetch, options: { dailyCallLimit?: number } = {}): OfficialZhihuClient {
  return new OfficialZhihuClient({
    accessSecret: 'secret-value',
    fetchImpl: fake.fetch,
    minIntervalMs: 0,
    timeoutMs: 1000,
    now: () => FIXED_NOW,
    ...(options.dailyCallLimit === undefined ? {} : { dailyCallLimit: options.dailyCallLimit }),
  })
}

describe('authentication', () => {
  it('sends the access secret as a bearer token', async () => {
    const fake = new FakeFetch({ 'creator_account_stats': jsonAnswer({ Code: 0, Data: {} }) })
    await clientWith(fake).accountStats()
    expect(fake.requests[0]?.headers[AUTH_HEADER]).toBe('Bearer secret-value')
  })

  it('sends a freshly taken timestamp header', async () => {
    const fake = new FakeFetch({ 'creator_account_stats': jsonAnswer({ Code: 0, Data: {} }) })
    await clientWith(fake).accountStats()
    expect(fake.requests[0]?.headers[TIMESTAMP_HEADER]).toBe(String(Math.floor(FIXED_NOW / 1000)))
  })

  it('requests the endpoint the table names', async () => {
    const fake = new FakeFetch({ 'creator_account_stats': jsonAnswer({ Code: 0, Data: {} }) })
    await clientWith(fake).accountStats()
    expect(fake.requests[0]?.url).toContain(ENDPOINT_PATHS[EndpointName.AccountStats])
  })

  it('passes the content url to the per-content endpoint', async () => {
    const fake = new FakeFetch({ 'creator_content_stats': jsonAnswer({ Code: 0, Data: { Items: [] } }) })
    await clientWith(fake).contentStats('https://www.zhihu.com/answer/42')
    expect(fake.requests[0]?.url).toContain('ContentUrl=https%3A%2F%2Fwww.zhihu.com%2Fanswer%2F42')
  })
})

describe('error classification', () => {
  it('maps 401 to an auth rejection', async () => {
    const fake = new FakeFetch({ 'creator_account_stats': { status: 401, body: '{}' } })
    await expect(clientWith(fake).accountStats()).rejects.toMatchObject({ code: ZhihuErrorCode.AuthRejected })
  })

  it('maps 429 to a rate limit', async () => {
    const fake = new FakeFetch({ 'creator_account_stats': { status: 429, body: '{}' } })
    await expect(clientWith(fake).accountStats()).rejects.toMatchObject({ code: ZhihuErrorCode.RateLimited })
  })

  it('maps a non-JSON body to an invalid response', async () => {
    const fake = new FakeFetch({ 'creator_account_stats': { status: 200, body: '<html>nope</html>' } })
    await expect(clientWith(fake).accountStats()).rejects.toMatchObject({ code: ZhihuErrorCode.InvalidResponse })
  })

  it('maps the platform business code 20001 to an auth rejection', async () => {
    const fake = new FakeFetch({ 'creator_account_stats': jsonAnswer({ Code: 20001, Message: 'auth failed' }) })
    await expect(clientWith(fake).accountStats()).rejects.toMatchObject({ code: ZhihuErrorCode.AuthRejected })
  })

  it('maps the platform business code 30003 to risk control', async () => {
    const fake = new FakeFetch({ 'creator_account_stats': jsonAnswer({ Code: 30003, Message: 'risk' }) })
    await expect(clientWith(fake).accountStats()).rejects.toMatchObject({ code: ZhihuErrorCode.RiskControlled })
  })

  it('maps a transport failure to a network error', async () => {
    const failing = async (): Promise<Response> => { throw new Error('connection reset') }
    const client = new OfficialZhihuClient({ accessSecret: 's', fetchImpl: failing as typeof fetch, minIntervalMs: 0 })
    await expect(client.accountStats()).rejects.toBeInstanceOf(ZhihuError)
  })
})

describe('local daily budget', () => {
  it('stops the pull once the cap is reached', async () => {
    const fake = new FakeFetch({ 'creator_account_stats': jsonAnswer({ Code: 0, Data: {} }) })
    const client = clientWith(fake, { dailyCallLimit: 2 })
    await client.accountStats()
    await client.accountStats()
    await expect(client.accountStats()).rejects.toMatchObject({ code: ZhihuErrorCode.DailyCapReached })
  })

  it('counts the calls it spent', async () => {
    const fake = new FakeFetch({ 'creator_account_stats': jsonAnswer({ Code: 0, Data: {} }) })
    const client = clientWith(fake)
    await client.accountStats()
    expect(client.usedToday()).toBe(1)
  })
})

describe('platform quota gate', () => {
  it('stops the pull once the platform reports nothing left', async () => {
    const fake = new FakeFetch({
      quota: jsonAnswer({ Code: 0, Data: [{ APIID: 'creator', TotalQuota: 500, TotalUsed: 500, RemainingQuota: 0 }] }),
      'creator_account_stats': jsonAnswer({ Code: 0, Data: {} }),
    })
    const client = clientWith(fake)
    await client.quota()
    await expect(client.accountStats()).rejects.toMatchObject({ code: ZhihuErrorCode.QuotaExhausted })
  })
})

describe('collection reads', () => {
  it('reads the content list', async () => {
    const fake = new FakeFetch({
      'user/contents': jsonAnswer({ Code: 0, Data: { Items: [{ ContentType: 'answer', Url: 'https://www.zhihu.com/answer/9', Title: 'T' }] } }),
    })
    const refs = await clientWith(fake).contents('answer', 5)
    expect(refs).toHaveLength(1)
    expect(refs[0]?.contentId).toBe('9')
  })

  it('reads the hot list with ranks', async () => {
    const fake = new FakeFetch({
      'hot_list': jsonAnswer({ Code: 0, Data: { Items: [{ Title: 'A' }, { Title: 'B' }] } }),
    })
    const items = await clientWith(fake).hotList()
    expect(items.map((item) => item.rank)).toEqual([1, 2])
  })

  it('reads the answerable questions', async () => {
    const fake = new FakeFetch({
      'question_recommendations': jsonAnswer({ Code: 0, Data: { Items: [{ Title: '好问题', Url: 'https://www.zhihu.com/question/7' }] } }),
    })
    const questions = await clientWith(fake).suggestedQuestions()
    expect(questions[0]?.title).toBe('好问题')
  })

  it('reads the quota reading', async () => {
    const fake = new FakeFetch({
      quota: jsonAnswer({ Code: 0, Data: [{ APIID: 'creator', TotalQuota: 500, TotalUsed: 5, RemainingQuota: 495 }] }),
    })
    const quota = await clientWith(fake).quota()
    expect(quota.remaining).toBe(495)
  })
})
