/**
 * Model-facing people-directory tools.
 *
 * `im_people` lets the model see who is known; `im_person_save` lets it record
 * the identity data a channel cannot supply (WeChat V1 sees only opaque user
 * ids). Names are resolved strictly by `im_send`, never by these tools.
 *
 * 面向模型的人员目录工具。
 *
 * `im_people` 让模型看见名单里有谁；`im_person_save` 让模型记录渠道给不出的身份信息（微信 V1
 * 只能看到不透明用户 id）。名字解析严格由 `im_send` 完成，这两个工具不做发送。
 *
 * @module @veren/im-tool/people-tools
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import { defineTool, type InferArgs, type ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'
import { ImError } from '@veren/im'
import type { ImPersonContact, ImPersonSaveInput, ImRouter } from '@veren/im'
import { ok, requireString, run } from './values.ts'

/** One canonical tool value as model text. */
function renderValue(_args: unknown, value: unknown): ContentBlock[] {
  return [{ type: 'text', text: JSON.stringify(value) }]
}

const OUTPUT = { schema: { type: 'json' }, render: renderValue } as const

/** Parse one optional string array argument. */
function aliasesOf(value: JsonValue | undefined): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new ImError('IM_INVALID_REQUEST', 'aliases must be an array of strings')
  return value.map(item => {
    if (typeof item !== 'string') throw new ImError('IM_INVALID_REQUEST', 'aliases must be strings')
    return item
  })
}

/** Parse one optional contacts argument; the model sends a JSON array. */
export function contactsOf(value: JsonValue | undefined): ImPersonContact[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) throw new ImError('IM_INVALID_REQUEST', 'contacts must be an array')
  return value.map(item => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      throw new ImError('IM_INVALID_REQUEST', 'each contact must be an object')
    }
    const record = item as Record<string, JsonValue>
    const kind = record.kind
    if (kind !== 'wechat' && kind !== 'email' && kind !== 'phone' && kind !== 'other') {
      throw new ImError('IM_INVALID_REQUEST', 'contact kind must be wechat, email, phone, or other')
    }
    const contactValue = record.value
    if (typeof contactValue !== 'string' || contactValue.trim() === '') {
      throw new ImError('IM_INVALID_REQUEST', 'each contact needs a non-empty value')
    }
    const label = record.label
    if (label !== undefined && typeof label !== 'string') {
      throw new ImError('IM_INVALID_REQUEST', 'contact label must be a string')
    }
    return {
      kind,
      value: contactValue,
      ...(label === undefined || label.trim() === '' ? {} : { label }),
    }
  })
}

/** `im_people` description: what the directory knows and what this tool does. */
/** `im_people` 描述：目录里有什么、本工具做什么。 */
const PEOPLE_LIST_DESCRIPTION = 'List or search the known people directory. Each record has a nickname '
  + '(displayName), optional realName, aliases/remarks, contacts (wechat/email/phone/other), '
  + 'bio, and reachable addresses (provider + accountId + conversationId). A person may also '
  + 'carry claimedName/claimedContacts from the automatic stranger question: that is the '
  + 'person\'s own unverified statement, shown with identityStatus=self-reported, and must '
  + 'never be presented as a verified realName. For what the person said about themselves in '
  + 'conversation, use im_person_report; this tool is for verified information. '
  + 'Call this before im_send when the user names '
  + 'someone. This tool only browses: im_send performs the exact match and refuses ambiguity.'

/** `im_people` parameters. */
/** `im_people` 参数。 */
const PEOPLE_LIST_PARAMETERS = {
  query: {
    type: 'string',
    description: 'Substring filter over names, aliases, contacts, ids, and addresses; omit to list all.',
  },
  provider: { type: 'string', description: 'Only people reachable through this provider, for example wechat.' },
  accountId: { type: 'string', description: 'Only people reachable through this account.' },
  limit: { type: 'number', description: 'Maximum people to return; default 50, maximum 200.' },
} as const satisfies ParameterSchemaSpec

/** `im_person_save` description: create-or-enrich, never send. */
/** `im_person_save` 描述：创建或补充人员，绝不发送。 */
const PERSON_SAVE_DESCRIPTION = 'Create or enrich one person in the directory. Create a person with accountId + '
  + 'conversationId (the address that can receive messages); update an existing person by '
  + 'personId. Use realName, aliases (remarks or other names), contacts, bio, and notes to make '
  + 'people distinguishable. What the other party said about themselves goes through '
  + 'im_person_report; use this tool only for verified information. '
  + 'This never sends a message. An address already owned by a '
  + 'different person is rejected instead of being reassigned.'

/** `im_person_save` parameters. */
/** `im_person_save` 参数。 */
const PERSON_SAVE_PARAMETERS = {
  personId: { type: 'string', description: 'Update this person; mutually compatible with a new address.' },
  accountId: { type: 'string', description: 'Authorized account of the address being recorded.' },
  conversationId: { type: 'string', description: 'Provider conversation id of the address.' },
  provider: { type: 'string', description: 'Provider id; defaults to the account provider.' },
  externalId: { type: 'string', description: 'Provider user id; derived from conversationId when omitted.' },
  addressName: { type: 'string', description: 'Provider-supplied name at this address, when one exists.' },
  displayName: { type: 'string', description: 'Nickname shown to humans and the model.' },
  realName: { type: 'string', description: 'Real name, when known.' },
  aliases: {
    type: 'array',
    items: { type: 'string' },
    description: 'Remarks and other names this person answers to.',
  },
  contacts: {
    type: 'json',
    description: 'JSON array of { kind: wechat|email|phone|other, value, label? }.',
  },
  bio: { type: 'string', description: 'Short description: role, relationship, context.' },
  notes: { type: 'string', description: 'Free-form notes kept with the person.' },
  clearClaim: {
    type: 'boolean',
    description: 'Drop the unverified self-reported claim; use after correcting it with realName/alias.',
  },
} as const satisfies ParameterSchemaSpec

/** `im_intake` description: the switch and its audit trail, read-only. */
/** `im_intake` 描述：自动采集开关与审计轨迹，只读。 */
const INTAKE_DESCRIPTION = 'Read the automatic stranger-intake switch and its audit trail. Returns enabled, '
  + 'the exact askText, replyWindowMs, per-account rate limits, status counts, and recent '
  + 'records (who, which account/conversation, when, what was sent, reply outcome). It is '
  + 'read-only: change strangerIntake.enabled in the im plugin config to switch it off. A '
  + 'self-reported name appears as claimedName with identityStatus=self-reported; never treat '
  + 'it as a verified realName.'

/** `im_intake` parameters. */
/** `im_intake` 参数。 */
const INTAKE_PARAMETERS = {
  limit: { type: 'number', description: 'Recent records to return; default 20, maximum 100.' },
} as const satisfies ParameterSchemaSpec

/** Inferred argument shapes of the three tools, derived from the schemas. */
/** 三个工具的参数形状，由 schema 推导而来。 */
type PeopleListArgs = InferArgs<typeof PEOPLE_LIST_PARAMETERS>
type PersonSaveArgs = InferArgs<typeof PERSON_SAVE_PARAMETERS>
type IntakeArgs = InferArgs<typeof INTAKE_PARAMETERS>

/** The `im_people` execution: one filtered read of the directory. */
/** `im_people` 执行：一次带过滤的目录读取。 */
function peopleListExecute(router: ImRouter): (args: PeopleListArgs) => Promise<JsonValue> {
  return async args => run(async () => {
    const people = router.listPeople({
      ...(args.query === undefined ? {} : { query: args.query }),
      ...(args.provider === undefined ? {} : { provider: args.provider }),
      ...(args.accountId === undefined ? {} : { accountId: args.accountId }),
      ...(args.limit === undefined ? {} : { limit: args.limit }),
    })
    return ok({ people, count: people.length })
  })
}

/**
 * Validate the address pair and build the save address, or undefined when the
 * request carries no address.
 * 校验地址对并构造保存地址；请求不带地址时返回 undefined。
 */
function saveAddressOf(args: PersonSaveArgs): ImPersonSaveInput['address'] {
  const hasAccount = args.accountId !== undefined
  const hasConversation = args.conversationId !== undefined
  if (hasAccount !== hasConversation) {
    throw new ImError('IM_INVALID_REQUEST', 'accountId and conversationId must be supplied together')
  }
  if (args.personId === undefined && !hasAccount) {
    throw new ImError('IM_INVALID_REQUEST', 'personId or accountId + conversationId is required')
  }
  if (!hasAccount) return undefined
  return {
    accountId: requireString(args.accountId, 'accountId'),
    conversationId: requireString(args.conversationId, 'conversationId'),
    ...(args.provider === undefined ? {} : { provider: args.provider }),
    ...(args.externalId === undefined ? {} : { externalId: args.externalId }),
    ...(args.addressName === undefined ? {} : { displayName: args.addressName }),
  }
}

/** Build the directory save request from the tool arguments, validation first. */
/** 先校验、再把工具参数装配成目录保存请求。 */
function personSaveRequestOf(args: PersonSaveArgs): ImPersonSaveInput {
  const address = saveAddressOf(args)
  const aliases = aliasesOf(args.aliases)
  const contacts = contactsOf(args.contacts)
  return {
    ...(args.personId === undefined ? {} : { personId: args.personId }),
    ...(address === undefined ? {} : { address }),
    ...(args.displayName === undefined ? {} : { displayName: args.displayName }),
    ...(args.realName === undefined ? {} : { realName: args.realName }),
    ...(aliases === undefined ? {} : { aliases }),
    ...(contacts === undefined ? {} : { contacts }),
    ...(args.bio === undefined ? {} : { bio: args.bio }),
    ...(args.notes === undefined ? {} : { notes: args.notes }),
    ...(args.clearClaim === undefined ? {} : { clearClaim: args.clearClaim }),
  }
}

/** The `im_person_save` execution: one validated create-or-enrich. */
/** `im_person_save` 执行：一次带校验的创建/补充。 */
function personSaveExecute(router: ImRouter): (args: PersonSaveArgs) => Promise<JsonValue> {
  return async args => run(async () => {
    const person = await router.savePerson(personSaveRequestOf(args))
    return ok({ person })
  })
}

/** The `im_intake` execution: one read of the switch and its audit trail. */
/** `im_intake` 执行：一次读取开关与审计轨迹。 */
function intakeExecute(router: ImRouter): (args: IntakeArgs) => Promise<JsonValue> {
  return async args => run(async () => {
    const status = router.intakeStatus(args.limit)
    return ok({ ...status })
  })
}

/** Build the `im_people` tool definition. */
/** 构造 `im_people` 工具定义。 */
function definePeopleListTool(router: ImRouter) {
  return defineTool({
    name: 'im_people',
    description: PEOPLE_LIST_DESCRIPTION,
    parameters: PEOPLE_LIST_PARAMETERS,
    output: OUTPUT,
    execute: peopleListExecute(router),
  })
}

/** Build the `im_person_save` tool definition. */
/** 构造 `im_person_save` 工具定义。 */
function definePersonSaveTool(router: ImRouter) {
  return defineTool({
    name: 'im_person_save',
    description: PERSON_SAVE_DESCRIPTION,
    parameters: PERSON_SAVE_PARAMETERS,
    output: OUTPUT,
    execute: personSaveExecute(router),
  })
}

/** Build the `im_intake` tool definition. */
/** 构造 `im_intake` 工具定义。 */
function defineIntakeTool(router: ImRouter) {
  return defineTool({
    name: 'im_intake',
    description: INTAKE_DESCRIPTION,
    parameters: INTAKE_PARAMETERS,
    output: OUTPUT,
    execute: intakeExecute(router),
  })
}

/**
 * Register the people-directory tools in the mounting scope.
 * @param ctx - Context owning the `tools` registry.
 * @param router - the active-binding router, which owns the directory.
 */
export function registerPeopleTools(ctx: Context, router: ImRouter): void {
  ctx.effect(() => {
    const disposers = [
      ctx.tools.register(definePeopleListTool(router)),
      ctx.tools.register(definePersonSaveTool(router)),
      ctx.tools.register(defineIntakeTool(router)),
    ]
    return () => { for (const dispose of disposers.reverse()) dispose() }
  }, 'im:people-tools()')
}
