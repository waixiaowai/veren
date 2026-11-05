import { describe, expect, it } from 'vitest'
import { ImPeople } from '../src/people.ts'
import { ImParticipants } from '../src/participants.ts'
import { MemoryStore } from './memory-store.ts'

/**
 * A DSH preset is an IM agent: discovered presets join the roster without a
 * config line, keep their display name and one-line purpose, and stay
 * addressable by `agent:<presetId>`.
 * 一个 DSH preset 就是一个 IM 智能体：发现到的 preset 不加配置也能进名册，保留展示名与
 * 一句话用途，并可用 `agent:<presetId>` 寻址。
 */
describe('participant roster with discovered presets', () => {
  it('adds a discovered preset as an agent participant', () => {
    const people = new ImPeople({ store: new MemoryStore(), logger: { warn() {}, error() {} } })
    const participants = new ImParticipants({
      roster: [],
      ownerName: 'Owner',
      people,
      discoveredAgents: () => [{ presetId: 'reviewer', name: 'Reviewer', description: 'Reads diffs.' }],
    })
    expect(participants.listAgents().map(agent => agent.id)).toEqual(['agent:default', 'agent:reviewer'])
    const reviewer = participants.resolve('agent:reviewer')
    expect(reviewer?.displayName).toBe('Reviewer')
    expect(reviewer?.description).toBe('Reads diffs.')
  })

  it('lets an explicit config entry win over the discovered row', () => {
    const people = new ImPeople({ store: new MemoryStore(), logger: { warn() {}, error() {} } })
    const participants = new ImParticipants({
      roster: [{ presetId: 'reviewer', name: '审阅者' }],
      ownerName: 'Owner',
      people,
      discoveredAgents: () => [{ presetId: 'reviewer', name: 'Reviewer' }],
    })
    expect(participants.resolve('agent:reviewer')?.displayName).toBe('审阅者')
  })
})
