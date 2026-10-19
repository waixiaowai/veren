/**
 * The auto-post drafting path with a scripted model stream.
 *
 * Auto-posting makes one model call outside any Session, so the specs drive
 * the real drafting path with a scripted `llm` service and assert what the
 * model was asked, how an untrusted reply is parsed, and which reply shapes
 * are refused with a stable code.
 *
 * 带脚本化模型流的自动发帖起草路径。
 *
 * 自动发帖在任何会话之外发出一次模型调用，因此这些用例用脚本化的 `llm` 服务驱动真实起草路径，
 * 并断言模型被要求了什么、不可信回复如何被解析、哪些回复形态会以稳定 code 被拒绝。
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { collectText, composePrompt, generatePost, parseDraft, toDraft } from '../src/compose.ts'
import type { ComposeInput } from '../src/compose.ts'
import type { BoardView, PostView } from '../src/types.ts'
// Type-only import: pulls the `ctx.agentDefaultModel` service declaration into
// this face so the fake can be published under its real key.
// 仅类型导入：把 `ctx.agentDefaultModel` 服务声明拉进这一面，假实现才能挂在真实键上。
import type {} from '@deepseek-ai/dsh-agent-default-model'

/** One provider/model pair the drafting call selects. 起草调用选中的一对提供方/模型。 */
interface ModelSelection {
  readonly provider: string
  readonly model: string
}

/** One board the draft is written for. 一份被起草帖子的板块。 */
function board(): BoardView {
  return { id: 'ws-1', path: 'C:/work/demo', title: 'Demo', postCount: 1 }
}

/** One recent post the prompt must mention. 一条提示词必须提到的近期帖子。 */
function recent(): readonly PostView[] {
  return [{
    id: 'p1',
    boardId: 'ws-1',
    author: 'standard',
    title: 'Earlier post',
    excerpt: '',
    tags: [],
    mentions: [],
    pinned: false,
    views: 1,
    up: 0,
    down: 0,
    commentCount: 0,
    heat: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }]
}

/** The drafting input the specs reuse. 这些用例复用的起草输入。 */
function input(over: Partial<ComposeInput> = {}): ComposeInput {
  return { preset: 'ptc', board: board(), recent: recent(), tags: ['闲聊', '进展'], ...over }
}

/** A stream that emits the given chunks. 发出给定分片的流。 */
function stream(chunks: readonly { readonly type: string, readonly text?: string }[]): AsyncIterable<{ type: string, text?: string }> {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const chunk of chunks) yield { ...chunk }
    },
  }
}

/** Mount a Host context whose `llm` and default-model selection are fakes. 挂载 `llm` 与默认模型选择都是假实现的宿主上下文。 */
function host(options: { chunks?: readonly { type: string, text?: string }[], selection?: ModelSelection | undefined } = {}) {
  const ctx = new Context()
  const seen: Record<string, unknown>[] = []
  // The service's `stream` returns the iterable synchronously; iteration happens
  // inside `collectText`. 服务的 `stream` 同步返回可迭代对象；迭代发生在 `collectText` 内。
  ctx.provide('llm', {
    stream(request: Record<string, unknown>) {
      seen.push(request)
      return stream(options.chunks ?? [{ type: 'text-delta', text: '{"title":"T","body":"B"}' }])
    },
  } as unknown as Context['llm'])
  // `agentDefaultModel` is optional for the drafting call, so the fake omits
  // the whole service when the spec has no selection to hand out.
  // `agentDefaultModel` 对起草调用是可选的，因此用例没有可选模型时假实现整个不提供该服务。
  if (options.selection !== undefined) {
    ctx.provide('agentDefaultModel', {
      currentSelection: () => options.selection,
    } as unknown as Context['agentDefaultModel'])
  }
  return { ctx, seen }
}

describe('forum auto-post prompt / 自动发帖提示词', () => {
  it('names the preset, the board, and the topic vocabulary', () => {
    const prompt = composePrompt(input())

    expect(prompt.text).toContain('「ptc」')
    expect(prompt.text).toContain('「Demo」')
    expect(prompt.text).toContain('闲聊')
    expect(prompt.text).toContain('- Earlier post')
  })

  it('says the board is empty instead of listing nothing', () => {
    expect(composePrompt(input({ recent: [] })).text).toContain('还没有帖子')
  })

  it('requires exactly one JSON object', () => {
    expect(composePrompt(input()).system).toContain('ONE JSON object')
  })
})

describe('forum auto-post reply parsing / 自动发帖回复解析', () => {
  it('accepts a reply wrapped in prose or a fence', () => {
    const draft = toDraft(parseDraft('好的，我写一条：\n```json\n{"title":"今日进展","body":"写完了第一版。","tags":["进展"]}\n```'))

    expect(draft).toMatchObject({ title: '今日进展', body: '写完了第一版。', tags: ['进展'] })
  })

  it('derives a title from the body when the model omitted one', () => {
    const draft = toDraft(parseDraft('{"body":"一段足够长的正文内容，用来派生标题。","tags":[]}'))

    expect(draft.title.length).toBeGreaterThan(0)
    expect(draft.title.length).toBeLessThanOrEqual(40)
    expect(draft.body).toContain('一段足够长')
  })

  it('keeps at most three normalized tags', () => {
    const draft = toDraft(parseDraft('{"title":"T","body":"B","tags":["进展","进展","闲聊","灵感","问题","1","2"]}'))

    expect(draft.tags.length).toBeLessThanOrEqual(3)
    for (const tag of draft.tags) expect(tag).not.toBe('进展'.repeat(2))
  })

  it('refuses a reply with no JSON object', () => {
    expect(() => parseDraft('今天不想发帖。')).toThrowError(expect.objectContaining({
      code: 'forum/input-invalid',
    }))
  })

  it('refuses JSON that is not an object', () => {
    expect(() => parseDraft('["title","body"]')).toThrowError(expect.objectContaining({
      code: 'forum/input-invalid',
    }))
  })

  it('refuses an empty body', () => {
    expect(() => toDraft(parseDraft('{"title":"T","body":"   "}'))).toThrowError(expect.objectContaining({
      code: 'forum/input-invalid',
    }))
  })
})

describe('forum auto-post drafting call / 自动发帖起草调用', () => {
  it('sends one one-shot request with the composed prompt', async () => {
    const { ctx, seen } = host({ selection: { provider: 'deepseek', model: 'v4-flash' } })
    const prompt = composePrompt(input())

    await generatePost(ctx, input())

    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({
      provider: 'deepseek',
      model: 'v4-flash',
      system: prompt.system,
      purpose: 'session-title',
    })
    const messages = seen[0]?.['messages'] as ReadonlyArray<{ content: ReadonlyArray<{ text: string }> }>
    expect(messages[0]?.content[0]?.text).toBe(prompt.text)
  })

  it('refuses to draft when no default model is configured', async () => {
    const { ctx, seen } = host({ selection: undefined })

    await expect(generatePost(ctx, input())).rejects.toMatchObject({ code: 'forum/not-auto-postable' })
    expect(seen).toHaveLength(0)
  })

  it('collects only the text chunks of the reply', async () => {
    const chunks = [
      { type: 'text-delta', text: '{"title":' },
      { type: 'reasoning-delta', text: 'let me think' },
      { type: 'text-delta', text: '"T","body":"B"}' },
      { type: 'text-delta' },
    ]

    await expect(collectText(stream(chunks))).resolves.toBe('{"title":"T","body":"B"}')
  })

  it('refuses a reply that never becomes a valid post', async () => {
    const { ctx } = host({
      selection: { provider: 'deepseek', model: 'v4-flash' },
      chunks: [{ type: 'text-delta', text: '抱歉，今天没有灵感。' }],
    })

    await expect(generatePost(ctx, input())).rejects.toMatchObject({ code: 'forum/input-invalid' })
  })
})