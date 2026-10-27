import { describe, expect, it } from 'vitest'
import { renderPrompt } from '../src/router-prompt.ts'
import type { ImMessage } from '../src/contract.ts'

function messageOf(text: string): ImMessage {
  return {
    id: 'm1',
    accountId: 'main',
    conversationId: 'p2p:u1',
    sender: { id: 'u1' },
    sentAt: Date.UTC(2026, 9, 27, 12, 0, 0),
    content: { type: 'text', text },
  }
}

describe('renderPrompt', () => {
  it('renders the sent time as a value, not as literal source code', () => {
    const prompt = renderPrompt('hub', messageOf('你好'))
    expect(prompt).toContain('time: 2026-10-27T12:00:00.000Z')
    expect(prompt).not.toContain('new Date(message.sentAt)')
  })

  it('carries the reply contract: the answer text itself is the channel reply', () => {
    const prompt = renderPrompt('hub', messageOf('你好'))
    expect(prompt).toContain('[Reply contract]')
    expect(prompt).toContain('自动回发')
    expect(prompt).toContain('do not call send tools')
  })

  it('keeps the known-sender label and the message body intact', () => {
    const prompt = renderPrompt('hub', messageOf('你好'), '杨明明')
    expect(prompt).toContain('sender: 杨明明 (u1)')
    expect(prompt.endsWith('你好') || prompt.includes('[Message]\n你好')).toBe(true)
  })
})
