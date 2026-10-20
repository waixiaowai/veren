/**
 * The low-privilege `im_person_report` tool.
 *
 * Reading a stranger's self-introduction is a semantic judgment, so the
 * conversation model decides what the person said and reports it here. The tool
 * writes only the unverified claim path (`people.recordClaim`); `realName`,
 * `displayName`, aliases, and contacts stay untouched. Format checks migrated
 * from the old deterministic parser remain as guardrails: one field that fails
 * is dropped and named in the result so the model can ask again.
 *
 * 低权限的 `im_person_report` 工具。
 *
 * 读懂陌生人的自我介绍是语义判断，由会话中的大模型判断对方说了什么并在此上报。工具只写未核实的
 * claim 路径（`people.recordClaim`）；realName、displayName、aliases、contacts 一律不动。从旧
 * 确定性解析器迁来的格式校验保留为护栏：某个字段不过就被丢弃，并在返回值里点名，模型可以追问。
 *
 * @module @veren/im-tool/report-tool
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { ImError } from '@veren/im'
import type { ImPersonContact, ImRouter } from '@veren/im'
import { contactsOf } from './people-tools.ts'
import { ok, requireString, run } from './values.ts'

/** One canonical tool value as model text. */
function renderValue(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

const OUTPUT = { schema: { type: 'json' }, render: renderValue } as const

/** Guardrails migrated from the old intake parser. 从旧 intake 解析器迁来的护栏。 */
const MAX_NAME_CHARS = 40
const MAX_CJK_NAME = 12
const BAD_NAME_CHARS = /[\d@#$%^&*_+=[\]{}|\\/<>~`!?;:，。！？、；：]/u
const WECHAT = /^[A-Za-z][-_A-Za-z0-9]{5,19}$/

/** Result value describing which fields failed a guardrail. */
type Rejections = Array<{ field: string; reason: string }>

/** Strip wrapping quotes a human might type around a name. */
function unquote(value: string): string {
  return value.replace(/^["'“”‘’《》]+|["'“”‘’《》]+$/gu, '').trim()
}

/**
 * Accept one name-shaped string, or reject it with a reason. Digits, sentence
 * punctuation, and over-long names are refused; the model keeps the semantic
 * judgment, this is only a shape check.
 * 接受一个姓名形状的字符串，否则给出拒绝原因。数字、句读与超长名字一律拒绝；语义判断归模型，
 * 这里只做形状检查。
 */
function guardedName(raw: string): { name?: string; reason?: string } {
  const text = unquote(raw.normalize('NFKC').replace(/\s+/g, ' ').trim())
  if (text === '') return { reason: 'name is empty' }
  if (text.length > MAX_NAME_CHARS) return { reason: `name exceeds ${MAX_NAME_CHARS} characters` }
  if (BAD_NAME_CHARS.test(text)) return { reason: 'name contains digits or punctuation' }
  const compact = [...text.replace(/\s+/g, '')]
  const cjk = compact.filter(char => /\p{Script=Han}/u.test(char)).length
  if (cjk > 0) {
    if (!compact.every(char => /\p{Script=Han}/u.test(char) || char === '·' || char === '•')) {
      return { reason: 'a Chinese name may only contain Han characters and ·' }
    }
    if (cjk < 2 || cjk > MAX_CJK_NAME) {
      return { reason: `a Chinese name must be 2-${MAX_CJK_NAME} characters` }
    }
    return { name: text }
  }
  if (!/^\p{L}[\p{L}.' -]*$/u.test(text)) return { reason: 'name is not letter-shaped' }
  const letters = text.replace(/[^\p{L}]/gu, '')
  const words = text.split(/\s+/).filter(Boolean)
  if (letters.length < 2 || words.length > 4) return { reason: 'name is not letter-shaped' }
  return { name: text }
}

/** Apply the per-kind format guardrails; one bad contact is dropped, not fatal. */
function guardedContacts(raw: ImPersonContact[] | undefined): { contacts: ImPersonContact[]; rejections: Rejections } {
  const contacts: ImPersonContact[] = []
  const rejections: Rejections = []
  for (const contact of raw ?? []) {
    if (contact.kind === 'wechat' && !WECHAT.test(contact.value)) {
      rejections.push({ field: 'contacts', reason: `wechat id "${contact.value}" must be 6-20 chars: letter first, then letters/digits/-/_` })
      continue
    }
    if (contact.kind === 'phone') {
      const digits = contact.value.replace(/\D/g, '')
      if (digits.length < 7 || digits.length > 15) {
        rejections.push({ field: 'contacts', reason: `phone "${contact.value}" must have 7-15 digits` })
        continue
      }
    }
    contacts.push(contact)
  }
  return { contacts, rejections }
}

/**
 * Register the report tool in the mounting scope.
 * @param ctx - Context owning the `tools` registry.
 * @param router - the active-binding router, which owns the directory and intake.
 */
export function registerReportTool(ctx: Context, router: ImRouter): void {
  ctx.effect(() => {
    const dispose = ctx.tools.register(defineTool({
      name: 'im_person_report',
      description: 'Record what one person said about themselves in conversation (their claimed name '
        + 'and/or offered contacts) after the automatic stranger question or an unprompted self-report. '
        + 'Judge the meaning of their messages yourself, then report only clearly stated facts here: '
        + 'this writes the unverified self-reported claim (shown as claimedName, '
        + 'identityStatus=self-reported), never realName or aliases. Set refused=true when the person '
        + 'declined to answer; that closes the open question without recording anything. A field that '
        + 'fails a format check is dropped and named in the result, so you may ask the person again.',
      parameters: {
        personId: { type: 'string', description: 'The person reporting; or give accountId + conversationId.' },
        accountId: { type: 'string', description: 'Account of the conversation the report came from.' },
        conversationId: { type: 'string', description: 'Conversation the report came from.' },
        name: { type: 'string', description: 'The name the person clearly used for themselves.' },
        contacts: {
          type: 'json',
          description: 'JSON array of { kind: wechat|email|phone|other, value, label? } the person offered.',
        },
        refused: {
          type: 'boolean',
          required: true,
          description: 'True when the person declined to answer; no claim is written then.',
        },
      },
      output: OUTPUT,
      async execute(args) {
        return run(async () => {
          const person = personOf(router, args)
          if (args.refused === true) {
            const settled = await router.settleIntake(person.id, 'declined')
            return ok({ recorded: false, declined: true, settled, personId: person.id })
          }
          const { contacts, rejections } = guardedContacts(contactsOf(args.contacts))
          const name = args.name === undefined ? {} : guardedName(args.name)
          if (name.reason !== undefined) rejections.unshift({ field: 'name', reason: name.reason })
          if (name.name === undefined && contacts.length === 0) {
            return ok({
              recorded: false,
              settled: false,
              personId: person.id,
              rejected: rejections,
            })
          }
          const provenance = provenanceOf(person, args)
          const updated = await router.reportPersonClaim(person.id, {
            ...(name.name === undefined ? {} : { name: name.name }),
            ...(contacts.length === 0 ? {} : { contacts }),
            accountId: provenance.accountId,
            conversationId: provenance.conversationId,
            messageId: 'im_person_report',
          })
          const settled = await router.settleIntake(
            person.id,
            'answered',
            name.name !== undefined && contacts.length > 0 ? 'both' : name.name !== undefined ? 'name' : 'contact',
          )
          return ok({
            recorded: true,
            settled,
            personId: person.id,
            person: updated,
            ...(rejections.length === 0 ? {} : { rejected: rejections }),
          })
        })
      },
    }))
    return () => { dispose() }
  }, 'im:report-tool()')
}

/** Resolve the target person by id or by conversation address. */
function personOf(router: ImRouter, args: {
  personId?: string
  accountId?: string
  conversationId?: string
}): { id: string; addresses: Array<{ accountId: string; conversationId: string }> } {
  if (args.personId !== undefined) {
    const person = router.personById(requireString(args.personId, 'personId'))
    if (person === undefined) throw new ImError('IM_NOT_FOUND', `unknown person: ${args.personId}`)
    return person
  }
  const hasAccount = args.accountId !== undefined
  const hasConversation = args.conversationId !== undefined
  if (!hasAccount || !hasConversation) {
    throw new ImError('IM_INVALID_REQUEST', 'personId or accountId + conversationId is required')
  }
  const person = router.personAt(
    requireString(args.accountId, 'accountId'),
    requireString(args.conversationId, 'conversationId'),
  )
  if (person === undefined) {
    throw new ImError('IM_NOT_FOUND', 'no person has been observed at this conversation yet')
  }
  return person
}

/** Claim provenance: the caller's conversation, or the person's first address. */
function provenanceOf(person: { addresses: Array<{ accountId: string; conversationId: string }> }, args: {
  accountId?: string
  conversationId?: string
}): { accountId: string; conversationId: string } {
  if (args.accountId !== undefined && args.conversationId !== undefined) {
    return { accountId: args.accountId, conversationId: args.conversationId }
  }
  const address = person.addresses[0]
  if (address !== undefined) return { accountId: address.accountId, conversationId: address.conversationId }
  throw new ImError('IM_INVALID_REQUEST', 'accountId and conversationId are required for the claim provenance')
}
