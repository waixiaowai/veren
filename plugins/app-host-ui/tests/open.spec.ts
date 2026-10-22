/**
 * Regression pin for the `appHost.open` Remote arity contract.
 *
 * The client gateway rejects a call whose argument count differs from the
 * endpoint's declared parameters ("expected 2 argument(s), got 1"), and the
 * failure surfaces as a silently unresponsive dropdown. These tests tie the
 * helper to the declaration: the endpoint must keep its two parameters, and
 * the helper must pass both (the optional url as an explicit undefined).
 *
 * `appHost.open` Remote 参数契约的回归钉。客户端网关会拒绝参数个数与端点声明
 * 不符的调用（"expected 2 argument(s), got 1"），失败表现就是下拉点了没反应。
 * 这组测试把 helper 钉到声明上：端点必须保持两个参数，helper 必须两个都传
 *（可选 url 显式 undefined）。
 */
import { describe, expect, it } from 'vitest'
import { appHostRemote } from '../src/client/remote.ts'
import { openAppPage } from '../src/client/open.ts'

describe('appHost/open 的 Remote 参数契约', () => {
  it('端点声明两个参数：appId 必填、url 可选', () => {
    const open = appHostRemote.methods['appHost/open']
    expect(open.parameters.map((parameter) => parameter.name)).toEqual(['appId', 'url'])
  })

  it('openAppPage 传满两个实参（url 显式 undefined），短调用会触发网关 arity 拒绝', async () => {
    const calls: unknown[][] = []
    const face = {
      open: async (...args: unknown[]) => {
        calls.push(args)
        return { ok: true, value: { sessionId: 's-1', url: '/apps/person-agent/overview', title: '个人工作台' } }
      },
    }
    const result = await openAppPage(face, 'person-agent')
    expect(calls).toEqual([['person-agent', undefined]])
    expect(result).toMatchObject({ ok: true })
  })
})
