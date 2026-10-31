import { describe, expect, it } from 'vitest'
import { address, duplicateContacts, seedYang, setup } from './people-helpers.ts'

describe('ImPeople resolution', () => {
  it('matches by real name, nickname, alias, contact, address, and person id', async () => {
    const { people } = setup()
    const yang = await seedYang(people)
    expect(people.resolve('杨明明')).toMatchObject({
      status: 'matched',
      match: { matchedBy: 'realName', matchedValue: '杨明明' },
    })
    expect(people.resolve('明明')).toMatchObject({
      status: 'matched',
      match: { matchedBy: 'displayName', matchedValue: '明明' },
    })
    expect(people.resolve('杨总')).toMatchObject({
      status: 'matched',
      match: { matchedBy: 'alias', matchedValue: '杨总' },
    })
    expect(people.resolve('yang_mingming')).toMatchObject({
      status: 'matched',
      // 证据=用户原始输入（P3b）：电话容错会让存储值偏离所打内容，展示依据必须是用户认得的那个
      match: { matchedBy: 'contact', matchedValue: 'yang_mingming' },
    })
    expect(people.resolve('p2p:wxid-yang')).toMatchObject({
      status: 'matched',
      match: { matchedBy: 'address' },
    })
    expect(people.resolve(yang.id)).toMatchObject({
      status: 'matched',
      match: { matchedBy: 'id', matchedValue: yang.id },
    })
  })

  it('matches a person who only has a nickname', async () => {
    const { people } = setup()
    await people.save({ address: address(), displayName: '小林' })
    const resolution = people.resolve('小林')
    expect(resolution.status).toBe('matched')
    if (resolution.status === 'matched') {
      expect(resolution.match.person.realName).toBeUndefined()
      expect(resolution.match.matchedBy).toBe('displayName')
    }
  })

  it('returns one match when several names point at the same person', async () => {
    const { people } = setup()
    const yang = await seedYang(people)
    for (const query of ['杨明明', '明明', '杨总', '小明']) {
      const resolution = people.resolve(query)
      expect(resolution.status).toBe('matched')
      if (resolution.status === 'matched') expect(resolution.match.person.id).toBe(yang.id)
    }
  })

  it('refuses two people with the same name', async () => {
    const { people } = setup()
    await people.save({ address: address('acc-1', 'wxid-a'), displayName: '杨明明' })
    await people.save({ address: address('acc-1', 'wxid-b'), displayName: '杨明明' })
    const resolution = people.resolve('杨明明')
    expect(resolution.status).toBe('ambiguous')
    if (resolution.status === 'ambiguous') {
      expect(resolution.candidates).toHaveLength(2)
      expect(resolution.candidates.every(item => item.matchedBy === 'displayName')).toBe(true)
    }
  })

  it('does not promote a partial name and suggests close names', async () => {
    const { people } = setup()
    await seedYang(people)
    const resolution = people.resolve('杨明')
    expect(resolution.status).toBe('not-found')
    if (resolution.status === 'not-found') {
      expect(resolution.suggestions.map(person => person.displayName)).toContain('明明')
    }
  })

  it('matches phone contacts regardless of separators', async () => {
    const { people } = setup()
    await people.save({
      address: address(),
      displayName: '小林',
      contacts: [{ kind: 'phone', value: '+86 138-0013-8000' }],
    })
    expect(people.resolve('13800138000')).toMatchObject({
      status: 'matched',
      match: { matchedBy: 'contact' },
    })
  })
})

describe('ImPeople listing', () => {
  it('lists every person and filters by query', async () => {
    const { people } = setup()
    await seedYang(people)
    await people.save({ address: address('acc-1', 'wxid-lin'), displayName: '小林' })
    expect(people.list()).toHaveLength(2)
    expect(people.list({ query: '杨' }).map(person => person.displayName)).toEqual(['明明'])
    expect(people.list({ query: 'wxid-yang' })).toHaveLength(1)
  })

  it('deduplicates aliases and contacts while keeping labels', async () => {
    const { people } = setup()
    const person = await seedYang(people, { aliases: ['杨总', ' 杨总 '], contacts: duplicateContacts })
    expect(person.aliases).toEqual(['杨总'])
    expect(person.contacts).toHaveLength(2)
    expect(person.contacts[1]?.label).toBe('工作')
  })
})
