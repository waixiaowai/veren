/**
 * The hand-built `forum` Remote contribution.
 *
 * The page and the model's `forum_*` tools must act on one record set, so this
 * contribution mirrors the Host's endpoints by hand. The specs pin the wire
 * contract — endpoint names, service key, request field requirements, and the
 * loose result schemas that tolerate Host additions — because a drift here
 * silently disconnects the page from every tool write.
 *
 * 手工构造的 `forum` 远端 contribution。
 *
 * 页面与模型的 `forum_*` 工具必须操作同一份记录集合，因此这个 contribution 手工镜像宿主
 * 端点。测试钉住线路约定——端点名、服务键、请求字段要求，以及容忍宿主增量变更的宽松结果
 * 模式——因为这里一旦漂移，页面就会在无声无息中与所有工具写入脱节。
 */

import { describe, expect, it } from 'vitest'
import { forumRemote, POST_SORTS } from '../src/client/remote.ts'

/** One descriptor by its wire endpoint. 按线路端点取一条描述符。 */
function descriptor(endpoint: string) {
  const found = forumRemote.descriptors.find(entry => `${entry.namespace}/${entry.method}` === endpoint)
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

describe('forum remote contract / 论坛远端约定', () => {
  it('publishes ten endpoints under the forum service', () => {
    expect(forumRemote.package).toBe('@veren/forum')
    const endpoints = forumRemote.descriptors
      .map(entry => `${entry.namespace}/${entry.method}`)
      .sort()
    expect(endpoints).toEqual([
      'forum/autoPost',
      'forum/catalog',
      'forum/comment',
      'forum/ensureBoard',
      'forum/inbox',
      'forum/markRead',
      'forum/pin',
      'forum/post',
      'forum/publish',
      'forum/vote',
    ])
    for (const entry of forumRemote.descriptors) {
      expect(entry.service, entry.id).toBe('forum')
      expect(entry.invocation.kind, entry.id).toBe('direct')
      expect(entry.description, entry.id).toBeTruthy()
    }
  })

  it('takes one request object per endpoint, named after the Host parameter', () => {
    for (const entry of forumRemote.descriptors) {
      expect(entry.parameters, entry.id).toHaveLength(1)
      expect(entry.parameters[0]).toMatchObject({ name: 'request', wire: 'request', source: 'json' })
    }
  })

  it('requires the publishing fields the Host validates', () => {
    const parse = requestSchema('forum/publish')
    expect(parse.safeParse({ boardId: 'b1', author: 'ada', title: 'Hi', body: 'Text' }).success).toBe(true)
    expect(parse.safeParse({ boardId: 'b1', author: 'ada', body: 'Text' }).success).toBe(false)
    expect(parse.safeParse({ boardId: 'b1', author: 'ada', title: 'Hi' }).success).toBe(false)
  })

  it('reads a catalog the Host may extend without losing the known fields', () => {
    const parse = resultSchema('forum/catalog')
    const value = parse.parse({
      boards: [{ id: 'b1', path: '/w', title: 'General', postCount: 2, addedLater: true }],
      posts: [{
        id: 'p1', boardId: 'b1', author: 'ada', title: 'Hello', excerpt: '',
        views: 0, up: 0, down: 0, commentCount: 0, pinned: false, addedLater: 'kept',
      }],
      people: [{ name: 'ada', autoPost: false }],
      addedLater: 'kept',
    }) as { boards: Array<Record<string, unknown>>, posts: Array<Record<string, unknown>> }

    expect(value.boards[0]).toMatchObject({ id: 'b1', addedLater: true })
    expect(value.posts[0]).toMatchObject({ id: 'p1', addedLater: 'kept' })
  })

  it('keeps the notification state open so a new Host state cannot break the page', () => {
    const parse = resultSchema('forum/inbox')
    expect(parse.safeParse([]).success).toBe(true)
    expect(parse.safeParse([
      { id: 'n1', recipient: 'ada', author: 'bob', summary: 'replied', state: 'archived' },
    ]).success).toBe(true)
    expect(parse.safeParse([{ id: 'n1' }]).success).toBe(false)
  })

  it('requires a numeric change count for markRead', () => {
    expect(resultSchema('forum/markRead').safeParse({ changed: 2 }).success).toBe(true)
    expect(resultSchema('forum/markRead').safeParse({ changed: '2' }).success).toBe(false)
  })

  it('requires an id for ensureBoard and pins the three sort keys', () => {
    expect(requestSchema('forum/ensureBoard').safeParse({ id: 'b1' }).success).toBe(false)
    expect(requestSchema('forum/ensureBoard').safeParse({ workspaceId: 'w1', path: '/w' }).success).toBe(true)
    expect([...POST_SORTS]).toEqual(['heat', 'new', 'views'])
  })
})
