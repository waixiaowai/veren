import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { ImPeople, ImRegistry, ImRouter } from '@veren/im'
import { createFakeProvider } from '../../testkit/src/index.ts'
import { registerPeopleTools } from '../src/people-tools.ts'
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

async function setup() {
  const ctx = new Context()
  const store = new TestStore()
  await store.putAccount({ id: 'acc-1', provider: 'fake', token_ref: 'im/x' })
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
    config: { autoCreateSession: false },
  })
  const tools = new ToolTable()
  ctx.provide('tools', tools)
  registerImTools(ctx, router)
  registerPeopleTools(ctx, router)
  return { store, fake, tools, router, people }
}

/** Narrow one tool result to a plain record. */
function recordOf(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('expected a JSON object')
  }
  return value as Record<string, unknown>
}

describe('im_person_save tool', () => {
  it('creates a person from an address and exposes every identity field', async () => {
    const { tools } = await setup()
    const saved = recordOf(await tools.call('im_person_save', {
      accountId: 'acc-1',
      conversationId: 'p2p:wxid-yang',
      displayName: '明明',
      realName: '杨明明',
      aliases: ['杨总', '小明'],
      contacts: [{ kind: 'wechat', value: 'yang_mingming' }],
      bio: '产品经理',
    }))
    expect(saved.ok).toBe(true)
    const person = recordOf(saved.person)
    expect(person.realName).toBe('杨明明')
    expect(person.aliases).toEqual(['杨总', '小明'])
    expect(person.contacts).toEqual([{ kind: 'wechat', value: 'yang_mingming' }])

    const listed = recordOf(await tools.call('im_people', {}))
    expect(listed.ok).toBe(true)
    const people = listed.people as Array<Record<string, unknown>>
    expect(people).toHaveLength(1)
    expect(people[0]?.displayName).toBe('明明')
    expect(people[0]?.realName).toBe('杨明明')
    expect((people[0]?.addresses as Array<Record<string, unknown>>)[0]?.externalId).toBe('wxid-yang')
  })

  it('updates an existing person by id without moving their address', async () => {
    const { tools } = await setup()
    const created = recordOf(await tools.call('im_person_save', {
      accountId: 'acc-1',
      conversationId: 'p2p:wxid-yang',
      displayName: '明明',
    }))
    const id = recordOf(created.person).id
    const updated = recordOf(await tools.call('im_person_save', {
      personId: id,
      realName: '杨明明',
      notes: 'IM 渠道对接人',
    }))
    expect(updated.ok).toBe(true)
    expect(recordOf(updated.person).realName).toBe('杨明明')
    expect(recordOf(updated.person).displayName).toBe('明明')
  })

  it('rejects creating a person without an address or an id', async () => {
    const { tools } = await setup()
    const result = recordOf(await tools.call('im_person_save', { displayName: '无名氏' }))
    expect(result.ok).toBe(false)
    expect(recordOf(result.error).code).toBe('IM_INVALID_REQUEST')
  })

  it('rejects an address that already belongs to another person', async () => {
    const { tools } = await setup()
    await tools.call('im_person_save', {
      accountId: 'acc-1',
      conversationId: 'p2p:wxid-yang',
      displayName: '明明',
    })
    const second = recordOf(await tools.call('im_person_save', {
      accountId: 'acc-1',
      conversationId: 'p2p:wxid-other',
      displayName: '别人',
    }))
    const result = recordOf(await tools.call('im_person_save', {
      personId: recordOf(second.person).id,
      accountId: 'acc-1',
      conversationId: 'p2p:wxid-yang',
    }))
    expect(result.ok).toBe(false)
    expect(recordOf(result.error).code).toBe('IM_INVALID_REQUEST')
  })

  it('clears an unverified self-report through clearClaim', async () => {
    const { tools, people } = await setup()
    const created = recordOf(await tools.call('im_person_save', {
      accountId: 'acc-1',
      conversationId: 'p2p:wxid-yang',
      displayName: '明明',
    }))
    const id = recordOf(created.person).id as string
    await people.recordClaim(id, {
      name: '杨明明',
      provider: 'fake',
      accountId: 'acc-1',
      conversationId: 'p2p:wxid-yang',
      messageId: 'm-1',
    })
    const cleared = recordOf(await tools.call('im_person_save', { personId: id, clearClaim: true }))
    expect(cleared.ok).toBe(true)
    expect(recordOf(cleared.person).claimedName).toBeUndefined()
    expect(recordOf(cleared.person).identityStatus).toBe('unverified')
  })
})

describe('im_send by person', () => {
  it('sends to the unique match and reports the evidence', async () => {
    const { tools, fake } = await setup()
    await tools.call('im_person_save', {
      accountId: 'acc-1',
      conversationId: 'p2p:wxid-yang',
      displayName: '明明',
      realName: '杨明明',
    })
    const result = recordOf(await tools.call('im_send', { person: '杨明明', text: '在吗' }))
    expect(result.ok).toBe(true)
    expect(result.delivered).toBe(true)
    expect(recordOf(result.recipient)).toMatchObject({
      displayName: '明明',
      matchedBy: 'realName',
      matchedValue: '杨明明',
      accountId: 'acc-1',
      conversationId: 'p2p:wxid-yang',
    })
    expect(fake.sent).toHaveLength(1)
    expect(fake.sent[0]?.target).toEqual({ accountId: 'acc-1', conversationId: 'p2p:wxid-yang' })
  })

  it('refuses an ambiguous name, lists candidates, and sends nothing', async () => {
    const { tools, fake } = await setup()
    for (const id of ['wxid-a', 'wxid-b']) {
      await tools.call('im_person_save', {
        accountId: 'acc-1',
        conversationId: `p2p:${id}`,
        displayName: '杨明明',
      })
    }
    const result = recordOf(await tools.call('im_send', { person: '杨明明', text: '在吗' }))
    expect(result.ok).toBe(false)
    const error = recordOf(result.error)
    expect(error.code).toBe('IM_AMBIGUOUS')
    const details = recordOf(error.details)
    expect(details.candidates as unknown[]).toHaveLength(2)
    expect(fake.sent).toHaveLength(0)
  })

  it('reports not-found with suggestions and sends nothing', async () => {
    const { tools, fake } = await setup()
    await tools.call('im_person_save', {
      accountId: 'acc-1',
      conversationId: 'p2p:wxid-yang',
      displayName: '杨明明',
    })
    const result = recordOf(await tools.call('im_send', { person: '杨明', text: '在吗' }))
    expect(result.ok).toBe(false)
    const error = recordOf(result.error)
    expect(error.code).toBe('IM_NOT_FOUND')
    const details = recordOf(error.details)
    expect((details.suggestions as unknown[]).length).toBeGreaterThan(0)
    expect(fake.sent).toHaveLength(0)
  })

  it('rejects combining a person with an explicit conversation', async () => {
    const { tools } = await setup()
    const result = recordOf(await tools.call('im_send', {
      person: '杨明明',
      conversationId: 'p2p:wxid-yang',
      text: '在吗',
    }))
    expect(result.ok).toBe(false)
    expect(recordOf(result.error).code).toBe('IM_INVALID_REQUEST')
  })

  it('sends to a claimed name and reports its unverified source', async () => {
    const { tools, people, fake } = await setup()
    const created = recordOf(await tools.call('im_person_save', {
      accountId: 'acc-1',
      conversationId: 'p2p:wxid-unknown',
    }))
    await people.recordClaim(recordOf(created.person).id as string, {
      name: '杨明明',
      provider: 'fake',
      accountId: 'acc-1',
      conversationId: 'p2p:wxid-unknown',
      messageId: 'm-1',
    })
    const result = recordOf(await tools.call('im_send', { person: '杨明明', text: '在吗' }))
    expect(result.ok).toBe(true)
    expect(recordOf(result.recipient)).toMatchObject({
      matchedBy: 'claimedName',
      matchedValue: '杨明明',
      identityStatus: 'self-reported',
      claimedName: '杨明明',
    })
    expect(fake.sent).toHaveLength(1)
  })
})

describe('im_intake tool', () => {
  it('reports the switch and the exact question without changing anything', async () => {
    const { tools } = await setup()
    const status = recordOf(await tools.call('im_intake', {}))
    expect(status.ok).toBe(true)
    expect(status.enabled).toBe(false)
    expect(status.askText).toContain('怎么称呼')
    expect(status.counts).toEqual({ asked: 0, answered: 0, declined: 0, expired: 0 })
  })
})
