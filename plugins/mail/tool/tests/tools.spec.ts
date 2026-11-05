/**
 * The tool face, against the contract the model sees.
 *
 * 工具面，针对模型所见的契约。
 */

import { describe, expect, it } from 'vitest'
import { failureOf, jsonOf, MAIL_OUTPUT_SCHEMA } from '../src/face.ts'
import { MailError } from '@veren/mail'

describe('mail tool face', () => {
  it('keeps a mail error\'s code and message', () => {
    const failure = failureOf(new MailError('MAIL_TRIGGER_RECIPIENT_INVALID', 'no such recipient'))
    expect(failure.code).toBe('MAIL_TRIGGER_RECIPIENT_INVALID')
    expect(failure.message).toBe('no such recipient')
  })

  it('wraps an unknown failure as an internal one', () => {
    const failure = failureOf(new Error('boom'))
    expect(failure.code).toBe('MAIL_INTERNAL')
    expect(failure.message).toBe('boom')
  })

  it('drops absent optional fields when projecting to JSON', () => {
    const projected = jsonOf({ subscriberId: 'user-1', email: undefined })
    expect(projected).toEqual({ subscriberId: 'user-1' })
  })

  it('declares an output shape the tool registry accepts', () => {
    expect(MAIL_OUTPUT_SCHEMA.type).toBe('object')
    expect(Object.keys(MAIL_OUTPUT_SCHEMA.properties)).toContain('ok')
  })
})
