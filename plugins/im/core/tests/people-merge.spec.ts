import { describe, expect, it } from 'vitest'
import { consolidatePeople } from '../src/people-merge.ts'
import type { ImPersonAddressRow, ImPersonIntakeRow, ImPersonRow } from '../src/store.ts'
import { MemoryStore } from './memory-store.ts'

/** One silent logger; consolidation log lines are not under test. */
const logger = { info: () => undefined, warn: () => undefined, error: () => undefined }

/** Build one person row with the required defaults filled in. */
function person(id: string, displayName: string, extra: Partial<ImPersonRow> = {}): ImPersonRow {
  return { id, display_name: displayName, aliases: [], contacts: [], updated_at: 1, ...extra }
}

/** One self-report claim carrying just a name. */
function claimOf(name: string): ImPersonRow['claim'] {
  return {
    name,
    contacts: [],
    source: 'self-report',
    provider: 'wechat',
    accountId: 'a2',
    conversationId: 'c2',
    messageId: 'm1',
    at: 5,
  }
}

/** One wechat address owned by a person. */
function address(personId: string, accountId: string, externalId: string): ImPersonAddressRow {
  return {
    person_id: personId,
    provider: 'wechat',
    account_id: accountId,
    conversation_id: `p2p:${externalId}`,
    external_id: externalId,
    updated_at: 1,
  }
}

/** One asked intake record. */
function intake(personId: string, askedAt: number): ImPersonIntakeRow {
  return {
    person_id: personId,
    provider: 'wechat',
    account_id: accountIdOf(personId),
    conversation_id: 'c1',
    status: 'asked',
    asked_at: askedAt,
    ask_message_id: `m${askedAt}`,
    ask_text: 'who are you',
  }
}

/** The account each synthetic intake pretends to belong to. */
function accountIdOf(personId: string): string {
  return personId === 'p1' ? 'a1' : 'a2'
}

describe('consolidatePeople', () => {
  it('merges duplicates of one provider identity into the claim holder', async () => {
    const store = new MemoryStore()
    await store.putPerson(person('p1', 'ext@im.wechat'))
    await store.putPerson(person('p2', 'ext@im.wechat'))
    await store.putPerson(person('p3', 'ext@im.wechat', { claim: claimOf('杨明明') }))
    await store.putPersonAddress(address('p1', 'a1', 'ext@im.wechat'))
    await store.putPersonAddress(address('p2', 'a2', 'ext@im.wechat'))
    await store.putPersonAddress(address('p3', 'a3', 'ext@im.wechat'))

    const merged = await consolidatePeople(store, logger)

    expect(merged).toBe(2)
    expect(store.people().map(row => row.id)).toEqual(['p3'])
    expect(store.personAddresses().length).toBe(3)
    expect(store.personAddresses().every(row => row.person_id === 'p3')).toBe(true)
  })

  it('links an address-less profile whose name is the raw external id', async () => {
    const store = new MemoryStore()
    await store.putPerson(person('orphan', 'ext@im.wechat'))
    await store.putPerson(person('live', 'ext@im.wechat'))
    await store.putPersonAddress(address('live', 'a1', 'ext@im.wechat'))

    const merged = await consolidatePeople(store, logger)

    expect(merged).toBe(1)
    expect(store.people().map(row => row.id)).toEqual(['live'])
    expect(store.personAddresses().every(row => row.person_id === 'live')).toBe(true)
  })

  it('keeps the newest intake record on the keeper and drops the rest', async () => {
    const store = new MemoryStore()
    await store.putPerson(person('p1', 'ext@im.wechat'))
    await store.putPerson(person('p2', 'ext@im.wechat', { claim: claimOf('杨明明') }))
    await store.putPersonAddress(address('p1', 'a1', 'ext@im.wechat'))
    await store.putPersonAddress(address('p2', 'a2', 'ext@im.wechat'))
    await store.putIntake(intake('p1', 100))
    await store.putIntake(intake('p2', 200))

    await consolidatePeople(store, logger)

    expect(store.people().map(row => row.id)).toEqual(['p2'])
    expect(store.intakes().length).toBe(1)
    expect(store.intakes()[0]).toMatchObject({ person_id: 'p2', asked_at: 200 })
  })

  it('leaves distinct humans untouched', async () => {
    const store = new MemoryStore()
    await store.putPerson(person('alice', 'Alice'))
    await store.putPerson(person('bob', 'Bob', { claim: claimOf('杨明明') }))
    await store.putPersonAddress(address('alice', 'a1', 'alice-ext@im.wechat'))
    await store.putPersonAddress(address('bob', 'a2', 'bob-ext@im.wechat'))

    const merged = await consolidatePeople(store, logger)

    expect(merged).toBe(0)
    expect(store.people().map(row => row.id)).toEqual(['alice', 'bob'])
  })

  it('is idempotent: a consolidated directory yields zero merges', async () => {
    const store = new MemoryStore()
    await store.putPerson(person('p1', 'ext@im.wechat'))
    await store.putPerson(person('p2', 'ext@im.wechat', { claim: claimOf('杨明明') }))
    await store.putPersonAddress(address('p1', 'a1', 'ext@im.wechat'))
    await store.putPersonAddress(address('p2', 'a2', 'ext@im.wechat'))
    await consolidatePeople(store, logger)

    const merged = await consolidatePeople(store, logger)

    expect(merged).toBe(0)
    expect(store.people().length).toBe(1)
  })
})
