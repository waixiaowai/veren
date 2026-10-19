/**
 * The hand-built `notebook` Remote contribution.
 *
 * The page and the model's `notebook_*` tools write through one Host record
 * set, so this contribution mirrors the Host endpoints by hand. The specs pin
 * the wire contract — endpoint names, service key, which fields the Host
 * requires, and the loose results that tolerate additive Host changes — because
 * a drift here disconnects the page from every tool write.
 *
 * 手工构造的 `notebook` 远端 contribution。
 *
 * 页面与模型的 `notebook_*` 工具写入同一份宿主记录集合，因此这个 contribution 手工镜像
 * 宿主端点。测试钉住线路约定——端点名、服务键、宿主要求哪些字段，以及容忍宿主增量变更的
 * 宽松结果——因为这里一旦漂移，页面就会与所有工具写入脱节。
 */

import { describe, expect, it } from 'vitest'
import { notebookRemote } from '../src/client/remote.ts'

/** One descriptor by its wire endpoint. 按线路端点取一条描述符。 */
function descriptor(endpoint: string) {
  const found = notebookRemote.descriptors.find(entry => `${entry.namespace}/${entry.method}` === endpoint)
  if (found === undefined) throw new Error(`missing remote endpoint ${endpoint}`)
  return found
}

/** The endpoint's strict result parser. 端点的严格结果解析器。 */
function resultSchema(endpoint: string) {
  const result = descriptor(endpoint).result
  if (result.mode !== 'strict') throw new Error(`${endpoint} must declare a strict result`)
  return result.create()
}

/** The endpoint's request parser. 端点的请求解析器。 */
function requestSchema(endpoint: string) {
  const parameter = descriptor(endpoint).parameters[0]
  if (parameter === undefined) throw new Error(`${endpoint} must declare its request parameter`)
  return parameter.codec.create()
}

describe('notebook remote contract / 记事本远端约定', () => {
  it('publishes the five endpoints under the notebook service', () => {
    expect(notebookRemote.package).toBe('@veren/notebook')
    const endpoints = notebookRemote.descriptors
      .map(entry => `${entry.namespace}/${entry.method}`)
      .sort()
    expect(endpoints).toEqual([
      'notebook/create',
      'notebook/deleteNote',
      'notebook/list',
      'notebook/owners',
      'notebook/update',
    ])
    for (const entry of notebookRemote.descriptors) {
      expect(entry.service, entry.id).toBe('notebook')
      expect(entry.invocation.kind, entry.id).toBe('direct')
      expect(entry.description, entry.id).toBeTruthy()
    }
  })

  it('takes one request object per endpoint, named after the Host parameter', () => {
    for (const entry of notebookRemote.descriptors) {
      expect(entry.parameters, entry.id).toHaveLength(1)
      expect(entry.parameters[0]).toMatchObject({ name: 'request', wire: 'request', source: 'json' })
    }
  })

  it('requires the owner on every read and write except the owner roster', () => {
    expect(requestSchema('notebook/owners').safeParse({}).success).toBe(true)
    expect(requestSchema('notebook/list').safeParse({}).success).toBe(false)
    expect(requestSchema('notebook/list').safeParse({ owner: 'ada' }).success).toBe(true)
    for (const endpoint of ['notebook/create', 'notebook/update', 'notebook/deleteNote']) {
      expect(requestSchema(endpoint).safeParse({ id: 'n1' }).success, endpoint).toBe(false)
    }
  })

  it('requires title and body when creating, but not when updating', () => {
    expect(requestSchema('notebook/create').safeParse({ owner: 'ada', title: 'T', body: 'B' }).success).toBe(true)
    expect(requestSchema('notebook/create').safeParse({ owner: 'ada', title: 'T' }).success).toBe(false)

    const update = requestSchema('notebook/update')
    expect(update.safeParse({ owner: 'ada', id: 'n1' }).success).toBe(true)
    expect(update.safeParse({ owner: 'ada', id: 'n1', body: 'B', expectedUpdatedAt: '2026-01-01' }).success).toBe(true)
  })

  it('reads a note the Host may extend without losing the known fields', () => {
    const parse = resultSchema('notebook/list')
    const [note] = parse.parse([
      {
        id: 'n1', title: 'T', body: 'B',
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z',
        addedLater: 'kept',
      },
    ]) as Array<Record<string, unknown>>

    expect(note).toMatchObject({ id: 'n1', addedLater: 'kept' })
    expect(() => parse.parse([{ id: 'n1', title: 'T' }])).toThrow()
  })

  it('reports owner and deletion results exactly as the page consumes them', () => {
    expect(resultSchema('notebook/owners').safeParse([{ id: 'ada', declared: true, noteCount: 2 }]).success).toBe(true)
    expect(resultSchema('notebook/owners').safeParse([{ id: 'ada' }]).success).toBe(false)
    expect(resultSchema('notebook/deleteNote').safeParse({ deleted: true }).success).toBe(true)
    expect(resultSchema('notebook/deleteNote').safeParse({ deleted: 'yes' }).success).toBe(false)
  })
})
