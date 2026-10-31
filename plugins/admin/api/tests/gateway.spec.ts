/**
 * Gateway behavior over a real HTTP server: the fixed order of request id,
 * origin, authentication, CSRF, authorization, validation, audit and errors.
 *
 * 真实 HTTP 服务器上的网关行为：请求 id、来源、认证、CSRF、授权、校验、审计与错误的
 * 固定顺序。
 */

import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it } from 'vitest'
import type { AdminUserView } from '@veren/admin-contract'
import { AdminKernel } from '@veren/admin-kernel'
import { AdminApi } from '../src/api.ts'
import { OWNER, createHarness, type Harness } from './gateway-harness.ts'

describe('admin API gateway', () => {
  let harness: Harness | undefined

  afterEach(async () => {
    await harness?.close()
    harness = undefined
  })

  it('serves a public route without authentication', async () => {
    harness = await createHarness()
    const response = await fetch(`${harness.base}/api/public/v1/health`)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: 'ok' })
  })

  it('rejects an unauthenticated admin route with a structured envelope', async () => {
    harness = await createHarness()
    const response = await fetch(`${harness.base}/api/admin/v1/users`)
    expect(response.status).toBe(401)
    const body = await response.json() as { error: { code: string; requestId: string } }
    expect(body.error.code).toBe('AUTH_REQUIRED')
    expect(body.error.requestId).toMatch(/[0-9a-f-]{36}/)
  })

  it('serves an authenticated route', async () => {
    harness = await createHarness()
    const response = await fetch(`${harness.base}/api/admin/v1/users`, { headers: { cookie: 'admin_session=good' } })
    expect(response.status).toBe(200)
    expect((await response.json() as { items: AdminUserView[] }).items[0]?.email).toBe('owner@example.com')
  })

  it('denies a caller without the route permission', async () => {
    harness = await createHarness()
    const response = await fetch(`${harness.base}/api/admin/v1/users`, { headers: { cookie: 'admin_session=limited' } })
    expect(response.status).toBe(200)

    const denied = await fetch(`${harness.base}/api/admin/v1/users`, {
      method: 'POST',
      headers: { cookie: 'admin_session=limited; admin_csrf=t', 'x-csrf-token': 't', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    })
    expect(denied.status).toBe(403)
    expect((await denied.json() as { error: { code: string } }).error.code).toBe('FORBIDDEN')
  })

  it('rejects a write without the CSRF pair', async () => {
    harness = await createHarness()
    const response = await fetch(`${harness.base}/api/admin/v1/users`, {
      method: 'POST',
      headers: { cookie: 'admin_session=good', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    })
    expect(response.status).toBe(403)
    expect((await response.json() as { error: { code: string } }).error.code).toBe('CSRF_FAILED')
  })

  it('accepts a write with the CSRF pair and records intent and success', async () => {
    harness = await createHarness()
    const response = await fetch(`${harness.base}/api/admin/v1/users`, {
      method: 'POST',
      headers: { cookie: 'admin_session=good; admin_csrf=tok', 'x-csrf-token': 'tok', 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'New' }),
    })
    expect(response.status).toBe(200)
    expect(harness.audits.map((entry) => [entry.action, entry.result])).toEqual([
      ['users.create', 'intent'],
      ['users.create', 'success'],
    ])
  })

  it('reports a validation failure as 422', async () => {
    harness = await createHarness()
    const response = await fetch(`${harness.base}/api/admin/v1/users`, {
      method: 'POST',
      headers: { cookie: 'admin_session=good; admin_csrf=tok', 'x-csrf-token': 'tok', 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    })
    expect(response.status).toBe(422)
    const body = await response.json() as { error: { code: string; details?: { field?: string } } }
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.details?.field).toBe('body')
  })

  it('enforces the route query schema before the handler runs', async () => {
    harness = await createHarness()
    const accepted = await fetch(`${harness.base}/api/admin/v1/search?q=hello`, {
      headers: { cookie: 'admin_session=good' },
    })
    expect(accepted.status).toBe(200)
    expect(await accepted.json()).toEqual({ q: 'hello' })

    const rejected = await fetch(`${harness.base}/api/admin/v1/search`, { headers: { cookie: 'admin_session=good' } })
    expect(rejected.status).toBe(422)
    const body = await rejected.json() as { error: { code: string; details?: { field?: string } } }
    expect(body.error.code).toBe('VALIDATION_FAILED')
    expect(body.error.details?.field).toBe('query')
  })

  it('answers 404 for an unknown path and 405 for a wrong method', async () => {
    harness = await createHarness()
    const missing = await fetch(`${harness.base}/api/admin/v1/nope`, { headers: { cookie: 'admin_session=good' } })
    expect(missing.status).toBe(404)

    const wrongMethod = await fetch(`${harness.base}/api/admin/v1/users`, {
      method: 'DELETE',
      headers: { cookie: 'admin_session=good' },
    })
    expect(wrongMethod.status).toBe(405)
  })

  it('rejects an untrusted origin and allows a trusted one', async () => {
    harness = await createHarness({ trustedOrigins: ['https://console.example.com'] })
    const untrusted = await fetch(`${harness.base}/api/public/v1/health`, { headers: { origin: 'https://evil.example.com' } })
    expect(untrusted.status).toBe(403)

    const trusted = await fetch(`${harness.base}/api/public/v1/health`, {
      headers: { origin: 'https://console.example.com' },
    })
    expect(trusted.status).toBe(200)
    expect(trusted.headers.get('access-control-allow-origin')).toBe('https://console.example.com')
  })

  it('rate limits a caller once the window budget is spent', async () => {
    harness = await createHarness({ rateLimit: { window: 60, max: 1 } })
    expect((await fetch(`${harness.base}/api/public/v1/health`)).status).toBe(200)
    const limited = await fetch(`${harness.base}/api/public/v1/health`)
    expect(limited.status).toBe(429)
    expect((await limited.json() as { error: { code: string } }).error.code).toBe('RATE_LIMITED')
  })

  it('generates OpenAPI from the live route table', () => {
    const ctx = new Context()
    new AdminKernel(ctx, { essential: [] })
    const api = new AdminApi(ctx, {})
    api.register({ audience: 'admin', method: 'GET', path: '/users/:id', summary: 'Read one user', handler: () => ({}) })
    const document = api.openapi() as {
      openapi: string
      paths: Record<string, Record<string, { summary: string; 'x-admin-permission'?: string }>>
    }
    expect(document.openapi).toBe('3.1.0')
    expect(document.paths['/api/admin/v1/users/:id']?.get?.summary).toBe('Read one user')
  })
})
