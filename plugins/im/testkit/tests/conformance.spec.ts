import { describe, expect, it } from 'vitest'
import { createFakeProvider, defineImConformance, splitText } from '../src/index.ts'

defineImConformance({
  name: 'fake',
  create() {
    const fake = createFakeProvider({ textChars: 20 })
    return {
      provider: fake.provider,
      sent: fake.sent,
      emit: message => fake.emit(message),
      confirmBind: account => fake.confirmBind(account),
    }
  },
})

describe('fake provider controls', () => {
  it('keeps surrogate pairs together when segmenting', () => {
    const chunks = splitText('a😀b', 3)
    expect(chunks.join('')).toBe('a😀b')
    expect(chunks.every(chunk => chunk.length <= 3)).toBe(true)
  })
})
