/**
 * 错误分类学规格：承重顺序（额度先于状态码）、429+14018 耗尽形态、冷却表、
 * 闭集穷尽性。
 * Error-taxonomy specs: the load-bearing order (credit before status), the
 * 429+14018 exhaustion shape, the cooldown table, closed-set exhaustiveness.
 */
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { assertNeverKind, classifyUpstreamError, cooldownForKind, extractDisplayErrorMessage, UPSTREAM_ERROR_KINDS, type UpstreamErrorKind } from '../src/index.ts'

describe('分类顺序 / classification order', () => {
  it('fixture 回放：HTTP 429 + 14018 是 hard_credit 而非 soft_rate（额度判定先于状态码）', async () => {
    const fixture = JSON.parse(await readFile(join(import.meta.dirname, 'fixtures', 'error-credit-exhausted.json'), 'utf8')) as { error: { data: { msg: string } } }
    const body = JSON.stringify(fixture)
    expect(classifyUpstreamError(429, body)).toBe('hard_credit')
    expect(extractDisplayErrorMessage(body)).toBe('额度已用尽，请购买加量包')
  })

  it('402 → hard_credit；401 → session_dead（无论体说什么）', () => {
    expect(classifyUpstreamError(402, '')).toBe('hard_credit')
    expect(classifyUpstreamError(401, '额度已用尽')).toBe('session_dead')
  })

  it('中文「已」变体与 code 14018 都落 hard_credit', () => {
    expect(classifyUpstreamError(200, '您的额度已用完')).toBe('hard_credit')
    expect(classifyUpstreamError(400, '{"error":{"data":{"code":14018}}}')).toBe('hard_credit')
  })

  it('会话死标记（含答成 403 的形态）', () => {
    expect(classifyUpstreamError(403, 'Offline user session not found')).toBe('session_dead')
    expect(classifyUpstreamError(500, '{"code":12153}')).toBe('session_dead')
  })

  it('状态码兜底：429 soft_rate / 404 not_found / 5xx server / 其余 client', () => {
    expect(classifyUpstreamError(429, 'too many')).toBe('soft_rate')
    expect(classifyUpstreamError(404, 'gone')).toBe('not_found')
    expect(classifyUpstreamError(503, '')).toBe('server')
    expect(classifyUpstreamError(400, 'bad')).toBe('client')
  })
})

describe('冷却表 / cooldown table', () => {
  it('hard_credit 1h / soft_rate 1min / server 10s；session_dead、client、not_found 不冷却', () => {
    expect(cooldownForKind('hard_credit')).toBe(3_600_000)
    expect(cooldownForKind('soft_rate')).toBe(60_000)
    expect(cooldownForKind('server')).toBe(10_000)
    expect(cooldownForKind('session_dead')).toBeUndefined()
    expect(cooldownForKind('client')).toBeUndefined()
    expect(cooldownForKind('not_found')).toBeUndefined()
  })

  it('闭集穷尽：每个类别都被表显式接住（新增类别编译期即报）', () => {
    for (const kind of UPSTREAM_ERROR_KINDS) {
      expect(() => cooldownForKind(kind)).not.toThrow()
    }
    expect(UPSTREAM_ERROR_KINDS).toHaveLength(6)
    // assertNeverKind 是编译期装置；运行期对非法输入抛（经 unknown 绕过编译期 never 检查）。
    expect(() => assertNeverKind('bogus' as unknown as never)).toThrow()
  })
})
