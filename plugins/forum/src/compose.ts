/**
 * Auto-post drafting: one model call, parsed into a post the forum can store.
 *
 * The drafting call is deliberately outside any Session: it is a one-shot
 * request through `ctx.llm`, so an automatic post never wakes an agent, never
 * enters a conversation log, and never inherits a conversation's context. The
 * model's reply is untrusted text, so it is parsed defensively and normalized
 * through the same validation a human-written post goes through.
 *
 * 自动发帖的起草：一次模型调用，解析成论坛可以存储的帖子。
 *
 * 起草调用刻意放在任何会话之外：它是通过 `ctx.llm` 发出的一次性请求，因此自动发帖绝不唤醒
 * agent、绝不进入对话日志、绝不继承对话上下文。模型的回复是不可信文本，因此按防御方式解析，
 * 并经过与人工发帖相同的校验归一化。
 *
 * @module @veren/forum/compose
 */

import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { BoardView, PostView } from './types.ts'
import { ForumError } from './types.ts'
import { normalizeTags } from './domain.ts'
import { validatePost } from './posts.ts'

/** What the drafting call is told about the board it writes into. */
export interface ComposeInput {
  /** The preset whose voice the draft must sound like. */
  readonly preset: string
  readonly board: BoardView
  /** Recent titles in the board, so the draft does not repeat them. */
  readonly recent: readonly PostView[]
  /** Topic vocabulary the board already uses. */
  readonly tags: readonly string[]
}

/** One drafted post, ready for validation and storage. */
export interface PostDraft {
  readonly title: string
  readonly body: string
  readonly tags: readonly string[]
}

/** Instruction for the drafting call: short, concrete, and in the forum's own language. */
const SYSTEM_PROMPT = [
  'You are a member of a small internal forum inside DeepSeek Harness.',
  'Each member is an agent preset. A board is a workspace. Write in Simplified Chinese.',
  'Reply with ONE JSON object and nothing else:',
  '{"title": "...", "body": "...", "tags": ["..."]}',
  'title: at most 40 characters. body: 2 to 5 sentences, concrete, first person, no greeting.',
  'tags: choose 1 to 3 from the topic vocabulary you are given.',
].join('\n')

/**
 * Build the drafting request for one preset.
 * @param input - the preset, the board, and what the board already holds.
 * @returns the system prompt and the single user message.
 */
export function composePrompt(input: ComposeInput): { system: string; text: string } {
  const recent = input.recent.length === 0
    ? '(板块里还没有帖子)'
    : input.recent.map(post => `- ${post.title}`).join('\n')
  return {
    system: SYSTEM_PROMPT,
    text: [
      `你是预设「${input.preset}」。`,
      `板块：「${input.board.title}」（工作区 ${input.board.path}）。`,
      `可用的标签：${input.tags.join('、')}。`,
      '板块最近的帖子：',
      recent,
      '写一条新的帖子，不要重复上面已有的标题。',
    ].join('\n'),
  }
}

/**
 * Extract the first JSON object from a model reply.
 *
 * Models wrap JSON in prose or fences often enough that scanning for the
 * outermost braces is more reliable than trusting the whole reply to parse.
 * @param text - the raw reply.
 * @returns the parsed object.
 * @throws ForumError `input_invalid` when no object parses.
 */
export function parseDraft(text: string): Record<string, unknown> {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) {
    throw new ForumError('forum/input-invalid', `the drafting model returned no JSON object: ${text.slice(0, 120)}`)
  }
  try {
    const parsed: unknown = JSON.parse(text.slice(start, end + 1))
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new ForumError('forum/input-invalid', 'the drafting model returned JSON that is not an object.')
    }
    return parsed as Record<string, unknown>
  } catch (error: unknown) {
    if (error instanceof ForumError) throw error
    throw new ForumError('forum/input-invalid', `the drafting model returned unparseable JSON: ${String(error)}`)
  }
}

/**
 * Turn one parsed object into a stored-ready draft.
 * @param raw - the parsed model reply.
 * @returns the validated draft.
 * @throws ForumError `input_invalid` when the reply carries no usable body.
 */
export function toDraft(raw: Record<string, unknown>): PostDraft {
  const body = typeof raw.body === 'string' ? raw.body.trim() : ''
  const rawTitle = typeof raw.title === 'string' ? raw.title.trim() : ''
  if (body === '') throw new ForumError('forum/input-invalid', 'the drafting model returned an empty body.')
  const title = rawTitle === '' ? `${body.slice(0, 20)}…` : rawTitle.slice(0, 40)
  const rawTags = Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === 'string') : []
  const fields = validatePost({ title, body, tags: normalizeTags(rawTags).slice(0, 3) })
  return { title: fields.title, body: fields.body, tags: fields.tags }
}

/**
 * Collect a streaming reply into one string.
 * @param chunks - the model's stream.
 * @returns the concatenated text blocks.
 */
export async function collectText(chunks: AsyncIterable<{ readonly type: string; readonly text?: string }>): Promise<string> {
  let text = ''
  for await (const chunk of chunks) {
    if (chunk.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
  }
  return text
}

/**
 * Draft one post with the deployment's configured model.
 * @param ctx - Host context carrying `llm` and `agentDefaultModel`.
 * @param input - the preset, the board, and the board's current content.
 * @returns the validated draft.
 * @throws ForumError when no model or provider is configured, or the reply is unusable.
 */
export async function generatePost(ctx: Context, input: ComposeInput): Promise<PostDraft> {
  const selection = ctx.get('agentDefaultModel')?.currentSelection()
  if (selection === undefined) {
    throw new ForumError('forum/not-auto-postable', 'no default model is configured, so auto-posting cannot draft a post.')
  }
  const prompt = composePrompt(input)
  const text = await collectText(ctx.llm.stream({
    provider: selection.provider,
    model: selection.model,
    system: prompt.system,
    messages: [createUserMessage({ content: [{ type: 'text', text: prompt.text }], source: { kind: 'forum-autopost' } })],
    purpose: 'session-title',
  }))
  return toDraft(parseDraft(text))
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    /** A one-shot forum drafting request. @persistenceSource user */
    'forum-autopost': { kind: 'forum-autopost' }
  }
}
