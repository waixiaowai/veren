/** 授权流：粘贴/环境导入两方法，在线校验失败绝不落库。 */
/** The authorization flow: the paste and env-import methods; a failed online validation never commits. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { AuthorizationSession } from '@deepseek-ai/dsh-authorization'
import type { CredentialKey, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import { registerImagegenFlow, type EnvReader } from '../src/auth-flow.js'
import { resolveConfig } from '../src/config.js'
import { IMAGEGEN_RECORD } from '../src/credential.js'
import { fakeCredentials } from './support/fakes.js'

const CONFIG = resolveConfig({ enabled: true })

interface RegisteredFlow {
  run(session: AuthorizationSession): Promise<void>
}

/** 假授权会话：notify 记账，prompt 按脚本应答。A fake authorization session: notifies recorded, prompt scripted. */
function fakeSession(method: string, promptAnswer: unknown): { session: AuthorizationSession; notes: string[] } {
  const notes: string[] = []
  return {
    notes,
    session: {
      method,
      notify: (note: { message: string }) => {
        notes.push(note.message)
      },
      prompt: async () => promptAnswer,
    } as unknown as AuthorizationSession,
  }
}

/** 只暴露 auth-flow 触碰的两个成员的最小 ctx 替身。 */
/** A minimal ctx stand-in exposing only the two members auth-flow touches. */
function fakeCtx(): { ctx: Context; records: Map<CredentialKey, CredentialRecord>; readonly flow: RegisteredFlow } {
  const records = new Map<CredentialKey, CredentialRecord>()
  let captured: RegisteredFlow | undefined
  const ctx = {
    credentials: fakeCredentials(records),
    authorization: {
      registerFlow(registered: RegisteredFlow) {
        captured = registered
        return () => {}
      },
    },
  }
  return {
    ctx: ctx as unknown as Context,
    records,
    // getter：注册发生在 registerImagegenFlow 调用时，取值必须滞后。
    // getter: registration happens inside registerImagegenFlow, so reads must be deferred.
    get flow() {
      if (captured === undefined) throw new Error('no flow registered')
      return captured
    },
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('paste method', () => {
  it('commits only after online validation passes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })))
    const fake = fakeCtx()
    const { ctx, records } = fake
    registerImagegenFlow(ctx, CONFIG)
    const { session } = fakeSession('paste-key', '  sk-good  ')
    await fake.flow.run(session)
    expect(records.get(IMAGEGEN_RECORD)).toMatchObject({ kind: 'api-key', key: 'sk-good' })
  })

  it('never commits when the endpoint rejects the key', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })))
    const fake = fakeCtx()
    const { ctx, records } = fake
    registerImagegenFlow(ctx, CONFIG)
    const { session } = fakeSession('paste-key', 'sk-bad')
    await expect(fake.flow.run(session)).rejects.toMatchObject({ code: 'IMAGEGEN_API_ERROR' })
    expect(records.size).toBe(0)
  })

  it('cancels cleanly on an empty paste', async () => {
    const fake = fakeCtx()
    const { ctx, records } = fake
    registerImagegenFlow(ctx, CONFIG)
    const { session } = fakeSession('paste-key', '   ')
    await expect(fake.flow.run(session)).rejects.toMatchObject({ code: 'IMAGEGEN_NO_KEY' })
    expect(records.size).toBe(0)
  })
})

describe('env-import method', () => {
  it('reads IMAGEGEN_API_KEY first and commits', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })))
    const fake = fakeCtx()
    const { ctx, records } = fake
    const readEnv: EnvReader = name => (name === 'IMAGEGEN_API_KEY' ? 'sk-env' : undefined)
    registerImagegenFlow(ctx, CONFIG, readEnv)
    const { session, notes } = fakeSession('import-env', undefined)
    await fake.flow.run(session)
    expect(records.get(IMAGEGEN_RECORD)).toMatchObject({ key: 'sk-env' })
    expect(notes.length).toBeGreaterThan(0)
  })

  it('falls back to OPENAI_API_KEY', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })))
    const fake = fakeCtx()
    const { ctx, records } = fake
    const readEnv: EnvReader = name => (name === 'OPENAI_API_KEY' ? 'sk-openai' : undefined)
    registerImagegenFlow(ctx, CONFIG, readEnv)
    await fake.flow.run(fakeSession('import-env', undefined).session)
    expect(records.get(IMAGEGEN_RECORD)).toMatchObject({ key: 'sk-openai' })
  })

  it('points at the paste method when no variable is set', async () => {
    const fake = fakeCtx()
    const { ctx, records } = fake
    registerImagegenFlow(ctx, CONFIG, () => undefined)
    await expect(fake.flow.run(fakeSession('import-env', undefined).session)).rejects.toMatchObject({
      code: 'IMAGEGEN_NO_KEY',
    })
    expect(records.size).toBe(0)
  })
})
