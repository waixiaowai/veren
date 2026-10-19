/**
 * Contract invariants: the capability table, the error-to-status mapping and
 * the shape of the error envelope's inputs.
 *
 * 契约不变量：能力表、错误到状态的映射，以及错误信封输入的形状。
 */

import { describe, expect, it } from 'vitest'
import {
  ADMIN_CONTRACT_VERSION,
  AdminError,
  ESSENTIAL_CAPABILITIES,
  OPTIONAL_CAPABILITIES,
  isAdminError,
  toAdminError,
} from '../src/index.ts'

describe('contract version and capabilities', () => {
  it('publishes a semver contract version', () => {
    expect(ADMIN_CONTRACT_VERSION).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it('keeps essential and optional capabilities disjoint', () => {
    const essential = new Set<string>(ESSENTIAL_CAPABILITIES)
    for (const optional of OPTIONAL_CAPABILITIES) expect(essential.has(optional)).toBe(false)
  })

  it('declares the five essential capabilities the design fixes', () => {
    expect([...ESSENTIAL_CAPABILITIES]).toEqual(['data', 'auth', 'access', 'navigation', 'audit'])
  })
})

describe('AdminError', () => {
  it('maps every stable code to its HTTP status', () => {
    expect(new AdminError('AUTH_REQUIRED', 'x').status).toBe(401)
    expect(new AdminError('FORBIDDEN', 'x').status).toBe(403)
    expect(new AdminError('CSRF_FAILED', 'x').status).toBe(403)
    expect(new AdminError('VALIDATION_FAILED', 'x').status).toBe(422)
    expect(new AdminError('NOT_FOUND', 'x').status).toBe(404)
    expect(new AdminError('CONFLICT', 'x').status).toBe(409)
    expect(new AdminError('PAYLOAD_TOO_LARGE', 'x').status).toBe(413)
    expect(new AdminError('RATE_LIMITED', 'x').status).toBe(429)
    expect(new AdminError('CAPABILITY_UNAVAILABLE', 'x').status).toBe(503)
    expect(new AdminError('BACKEND_UNAVAILABLE', 'x').status).toBe(503)
    expect(new AdminError('INTERNAL', 'x').status).toBe(500)
  })

  it('keeps its code, message and details', () => {
    const error = new AdminError('CONFLICT', 'already exists', { field: 'email' })
    expect(error.code).toBe('CONFLICT')
    expect(error.message).toBe('already exists')
    expect(error.details).toEqual({ field: 'email' })
    expect(isAdminError(error)).toBe(true)
  })

  it('wraps foreign failures as INTERNAL without losing the message', () => {
    const wrapped = toAdminError(new Error('boom'))
    expect(wrapped.code).toBe('INTERNAL')
    expect(wrapped.message).toBe('boom')
  })

  it('returns an existing platform error unchanged', () => {
    const original = new AdminError('NOT_FOUND', 'missing')
    expect(toAdminError(original)).toBe(original)
  })
})
