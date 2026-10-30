/**
 * 上游客户端规格：头族组装（桌面身份/账号身份/指纹/X-Agent 不对称/追踪族）、
 * chat SSE 回放、错误分类携带、探测挂断。
 * Upstream-client specs: header-family assembly (desktop identity, account
 * identity, fingerprints, X-Agent asymmetry, tracking family), chat SSE replay,
 * classified failures, probe hang-up.
 */
import { describe, expect, it } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chatStream, probeEffort, type RefreshableCredential } from '../src/index.ts'
import { deriveId } from '../src/fingerprint.ts'
import { startMockUpstream } from './support/mock-upstream.ts'

function credential(region: 'cn' | 'global'): RefreshableCredential {
  return {
    accessToken: 'at-1', refreshToken: 'rt-1', expiresAtMs: Date.now() + 3_600_000,
    domain: region === 'global' ? 'workbuddy.ai' : 'codebuddy.cn',
    uid: 'u-1', region,
  }
}

async function sseBody(): Promise<string> {
  return readFile(join(import.meta.dirname, 'fixtures', 'chat-sse.txt'), 'utf8')
}

describe('chat 头族 / chat header families', () => {
  it('桌面身份 + 账号身份 + 指纹 + 授权一次到位（CN）', async () => {
    const upstream = await startMockUpstream()
    try {
      await chatStream({ credential: credential('cn'), body: '{"messages":[{"role":"user","content":"hi"}]}', fetchImpl: fetch, baseUrl: upstream.origin })
      const request = upstream.requests.at(-1)
      expect(request?.path).toBe('/v2/chat/completions')
      expect(request?.headers['x-ide-version']).toBe('5.5.6')
      expect(request?.headers['x-user-id']).toBe('u-1')
      expect(request?.headers['x-machine-id']).toBe(deriveId('machine', 'u-1'))
      expect(request?.headers['authorization']).toBe('Bearer at-1')
      expect(request?.headers['x-agent-intent']).toBe('craft')
      expect(request?.headers['x-agent-purpose']).toBe('conversation')
      // CN 不发 X-Agent-Type: main（该不对称正是 CN 对同体不吭声的原因）。
      expect(request?.headers['x-agent-type']).toBeUndefined()
      expect(request?.headers['x-conversation-request-id']).toMatch(/^[0-9a-f]{32}$/)
      // 请求体已按区域备好方言。
      expect(JSON.parse(request?.body ?? '{}').stream).toBe(true)
    } finally {
      await upstream.close()
    }
  })

  it('国际版：X-Agent-Type: main 在场；缺 system 时体已前插；UA 是国际形', async () => {
    const upstream = await startMockUpstream()
    try {
      await chatStream({ credential: credential('global'), body: '{"messages":[{"role":"user","content":"hi"}]}', fetchImpl: fetch, baseUrl: upstream.origin })
      const request = upstream.requests.at(-1)
      expect(request?.headers['x-agent-type']).toBe('main')
      expect(request?.headers['user-agent']).toContain('WorkBuddy AI/5.5.2')
      const body = JSON.parse(request?.body ?? '{}') as { messages: { role: string }[] }
      expect(body.messages[0]?.role).toBe('system')
      expect(request?.headers['x-ide-version']).toBe('5.5.2')
    } finally {
      await upstream.close()
    }
  })

  it('缺账号身份字段时发 X-No-* 替身，不发空白头', async () => {
    const upstream = await startMockUpstream()
    try {
      const anonymous = { ...credential('cn'), uid: '', domain: '' }
      await chatStream({ credential: anonymous, body: '{"messages":[]}', fetchImpl: fetch, baseUrl: upstream.origin })
      const headers = upstream.requests.at(-1)?.headers ?? {}
      expect(headers['x-no-user-id']).toBe('1')
      expect(headers['x-no-department-info']).toBe('1')
      expect(headers['x-user-id']).toBeUndefined()
      // 空 uid：设备指纹整族不发。
      expect(headers['x-machine-id']).toBeUndefined()
    } finally {
      await upstream.close()
    }
  })
})

describe('chat 结果 / chat results', () => {
  it('成功：响应原样交回（SSE 由壳层解析）', async () => {
    const upstream = await startMockUpstream()
    try {
      upstream.chatBody = await sseBody()
      const result = await chatStream({ credential: credential('cn'), body: '{"messages":[]}', fetchImpl: fetch, baseUrl: upstream.origin })
      expect(result.ok).toBe(true)
    } finally {
      await upstream.close()
    }
  })

  it('fixture 回放：429+14018 分类 hard_credit 并携带 displayMsg', async () => {
    const upstream = await startMockUpstream()
    try {
      const body = await readFile(join(import.meta.dirname, 'fixtures', 'error-credit-exhausted.json'), 'utf8')
      upstream.chatStatus = 429
      upstream.chatBody = body
      const result = await chatStream({ credential: credential('cn'), body: '{"messages":[]}', fetchImpl: fetch, baseUrl: upstream.origin })
      expect(result).toMatchObject({ ok: false, status: 429, kind: 'hard_credit', displayMessage: '额度已用尽，请购买加量包' })
    } finally {
      await upstream.close()
    }
  })

  it('会话键用于派生追踪头但绝不外发原文', async () => {
    const upstream = await startMockUpstream()
    try {
      await chatStream({ credential: credential('cn'), body: '{"messages":[{"role":"user","content":"hi"}]}', sessionKey: 'sess-secret-42', fetchImpl: fetch, baseUrl: upstream.origin })
      const request = upstream.requests.at(-1)
      expect(JSON.stringify(request?.headers)).not.toContain('sess-secret-42')
    } finally {
      await upstream.close()
    }
  })
})

describe('探测 / probe', () => {
  it('探测共享 chat 通道与方言（国际版自动前插 system、max_tokens 用下限 16）', async () => {
    const upstream = await startMockUpstream()
    try {
      const result = await probeEffort(credential('global'), 'gpt-5.6-luna', undefined, new AbortController().signal, { fetchImpl: fetch, baseUrl: upstream.origin })
      expect(result).toMatchObject({ status: 200, streamed: true })
      const request = upstream.requests.at(-1)
      const body = JSON.parse(request?.body ?? '{}') as { messages: { role: string }[]; max_tokens: number; model: string }
      expect(body.messages[0]?.role).toBe('system')
      expect(body.max_tokens).toBe(16)
      expect(body.model).toBe('gpt-5.6-luna')
    } finally {
      await upstream.close()
    }
  })

  it('基线尝试不带 reasoning_effort 字段（真裸请求）', async () => {
    const upstream = await startMockUpstream()
    try {
      await probeEffort(credential('cn'), 'glm-5.3', undefined, new AbortController().signal, { fetchImpl: fetch, baseUrl: upstream.origin })
      expect('reasoning_effort' in JSON.parse(upstream.requests.at(-1)?.body ?? '{}')).toBe(false)
    } finally {
      await upstream.close()
    }
  })
})
