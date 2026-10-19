/**
 * The hand-built `startup` Remote contribution.
 *
 * This package lives outside the Harness checkout, so the contribution is
 * written by hand instead of generated. The specs pin the wire contract the
 * Host expects — endpoint names, service key, parameter names, and the loose
 * codecs that keep an additive Host change from breaking the page — because a
 * drift here disconnects the panel from every `startup_*` tool write.
 *
 * 手工构造的 `startup` 远端 contribution。
 *
 * 本包位于 Harness 检出仓库之外，因此 contribution 是手写的而不是生成的。测试钉住宿主
 * 期望的线路约定——端点名、服务键、参数名，以及让宿主增量变更不会打断页面的宽松编解码
 * 器——因为这里一旦漂移，面板就会与所有 `startup_*` 工具的写入脱节。
 */

import { describe, expect, it } from 'vitest'
import { STARTUP_ACTIONS, startupRemote } from '../src/client/remote.ts'

/** One descriptor by its wire endpoint. 按线路端点取一条描述符。 */
function descriptor(endpoint: string) {
  const found = startupRemote.descriptors.find(entry => `${entry.namespace}/${entry.method}` === endpoint)
  if (found === undefined) throw new Error(`missing remote endpoint ${endpoint}`)
  return found
}

/** The minimal runtime parser every strict codec carries. 每个严格编解码器都带的最小运行时解析器。 */
interface RuntimeSchema {
  parse(value: unknown): unknown
}

/** The endpoint's strict result parser. 端点的严格结果解析器。 */
function resultSchema(endpoint: string): RuntimeSchema {
  // The descriptor's public type exposes the strict branch through `mode`; the
  // runtime object is the Zod factory the contribution was built with, whose
  // only contract this spec needs is `parse`.
  // 描述符的公开类型通过 `mode` 暴露严格分支；运行时对象就是构造 contribution 时的
  // Zod 工厂，这些测试只需要它的 `parse`。
  const result = descriptor(endpoint).result as { readonly mode: string, create(): RuntimeSchema }
  if (result.mode !== 'strict') throw new Error(`${endpoint} must declare a strict result`)
  return result.create()
}

/** The endpoint's request parser. 端点的请求解析器。 */
function requestSchema(endpoint: string): RuntimeSchema {
  const parameter = descriptor(endpoint).parameters[0]
  if (parameter === undefined) throw new Error(`${endpoint} must declare its request parameter`)
  return parameter.codec.create() as RuntimeSchema
}

describe('startup remote contract / 启动项远端约定', () => {
  it('publishes the five endpoints under the startupAutostart service', () => {
    expect(startupRemote.package).toBe('@veren/startup-autostart')
    const endpoints = startupRemote.descriptors
      .map(entry => `${entry.namespace}/${entry.method}`)
      .sort()
    expect(endpoints).toEqual([
      'startup/catalog',
      'startup/create',
      'startup/delete',
      'startup/run',
      'startup/update',
    ])
    for (const entry of startupRemote.descriptors) {
      expect(entry.service, entry.id).toBe('startupAutostart')
      expect(entry.invocation.kind, entry.id).toBe('direct')
      expect(entry.description, entry.id).toBeTruthy()
    }
  })

  it('names every parameter after the Host parameter and keeps catalog parameterless', () => {
    expect(descriptor('startup/catalog').parameters).toHaveLength(0)
    for (const endpoint of ['startup/create', 'startup/update', 'startup/delete', 'startup/run']) {
      const parameters = descriptor(endpoint).parameters
      expect(parameters, endpoint).toHaveLength(1)
      expect(parameters[0]).toMatchObject({ name: 'request', wire: 'request', source: 'json' })
    }
  })

  it('accepts an item the Host has extended but still rejects an unknown action', () => {
    const parse = resultSchema('startup/catalog')
    const [parsed] = parse.parse([
      { id: 's1', name: 'Daily', enabled: true, action: 'new_session', addedLater: 'kept' },
    ]) as Array<Record<string, unknown>>

    // Additive Host fields must survive so the page keeps rendering.
    // 宿主的增量字段必须保留，页面才能继续渲染。
    expect(parsed).toMatchObject({ id: 's1', action: 'new_session', addedLater: 'kept' })
    expect(() => parse.parse([
      { id: 's1', name: 'Daily', enabled: true, action: 'not-an-action' },
    ])).toThrow()
  })

  it('requires the item id on update and delete requests', () => {
    const update = requestSchema('startup/update')
    const remove = requestSchema('startup/delete')

    expect(() => update.parse({ name: 'renamed' })).toThrow()
    expect(update.parse({ id: 's1', name: 'renamed', extra: true })).toMatchObject({ id: 's1' })
    expect(() => remove.parse({})).toThrow()
    expect(remove.parse({ id: 's1' })).toMatchObject({ id: 's1' })
  })

  it('models a run result whose outcome is optional', () => {
    const parse = resultSchema('startup/run')
    expect(parse.parse({ id: 's1' })).toMatchObject({ id: 's1' })
    expect(parse.parse({
      id: 's1',
      outcome: { status: 'failed', detail: 'exit 1', at: '2026-01-01T00:00:00.000Z' },
    })).toMatchObject({ outcome: { status: 'failed' } })
    expect(() => parse.parse({ id: 's1', outcome: { status: 'skipped', detail: '', at: '' } })).toThrow()
  })

  it('pins the four actions the Host can deliver', () => {
    expect([...STARTUP_ACTIONS]).toEqual(['new_session', 'resume_session', 'message_session', 'queue_message'])
  })
})
