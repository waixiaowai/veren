import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { ImPeople, ImRegistry, ImRouter } from '@veren/im'
import { createFakeProvider } from '../../testkit/src/index.ts'
import { registerImTools } from '../src/tools.ts'
import { TestStore } from './test-store.ts'

/** Tiny tool registry that runs the definition a tool plugin registered. */
class ToolTable {
  readonly definitions = new Map<string, ToolDefinition>()

  register(definition: ToolDefinition): () => void {
    this.definitions.set(definition.name, definition)
    return () => { this.definitions.delete(definition.name) }
  }

  async call(name: string, args: unknown): Promise<unknown> {
    const definition = this.definitions.get(name)
    if (definition === undefined) throw new Error(`tool not registered: ${name}`)
    return definition.execute(args, { signal: new AbortController().signal } as ToolRunContext)
  }
}

function setup() {
  const ctx = new Context()
  const store = new TestStore()
  const fake = createFakeProvider({ id: 'fake' })
  const registry = new ImRegistry(ctx, () => {})
  registry.register(fake.provider)
  const logger = { warn() {}, error() {} }
  const people = new ImPeople({ store, logger })
  const router = new ImRouter({
    store,
    registry,
    gateway: {
      async ensureSession() { return { sessionId: 'session-1', created: true } },
      async ask() { return undefined },
    },
    credentials: { async remove() {} },
    people,
    logger,
    config: {},
  })
  const tools = new ToolTable()
  ctx.provide('tools', tools)
  registerImTools(ctx, router)
  return { fake, tools }
}

/** Narrow one tool result to a plain record. */
function recordOf(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('expected a JSON object')
  }
  return value as Record<string, unknown>
}

describe('im_bind tool', () => {
  it('returns bindId, local challenge, and expiresAt without a remote URL', async () => {
    const { tools } = setup()
    const result = recordOf(await tools.call('im_bind', { provider: 'fake', method: 'qrcode' }))
    expect(result.ok).toBe(true)
    expect(typeof result.bindId).toBe('string')
    expect(typeof result.expiresAt).toBe('number')
    const challenge = recordOf(result.challenge)
    expect(challenge.kind).toBe('qrcode')
    expect(typeof challenge.imagePath).toBe('string')
    expect(challenge.url).toBeUndefined()
    expect(JSON.stringify(result)).not.toContain('https://')
  })

  it('polls with bindId only and reaches confirmed', async () => {
    const { fake, tools } = setup()
    const started = recordOf(await tools.call('im_bind', { provider: 'fake', method: 'qrcode' }))
    const bindId = started.bindId
    expect(typeof bindId).toBe('string')
    fake.confirmBind({ id: 'acc-1', displayName: 'Probe', status: 'online' })
    const polled = recordOf(await tools.call('im_bind', { bindId }))
    expect(polled.ok).toBe(true)
    expect(polled.status).toBe('bound')
    expect(recordOf(polled.account).id).toBe('acc-1')
  })

  it('rejects bindId and method together', async () => {
    const { tools } = setup()
    const result = recordOf(await tools.call('im_bind', {
      provider: 'fake',
      method: 'qrcode',
      bindId: 'bind-1',
    }))
    expect(result.ok).toBe(false)
    expect(recordOf(result.error).code).toBe('IM_INVALID_REQUEST')
  })

  it('returns IM_NOT_FOUND for an unknown provider', async () => {
    const { tools } = setup()
    const result = recordOf(await tools.call('im_bind', { provider: 'missing', method: 'qrcode' }))
    expect(result.ok).toBe(false)
    expect(recordOf(result.error).code).toBe('IM_NOT_FOUND')
  })
})
