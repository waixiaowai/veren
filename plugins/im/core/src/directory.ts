/**
 * The people-directory face: browsing, resolution, conversation lookups,
 * self-report recording, and the create-or-enrich save path.
 *
 * Everything here is read-or-write on the directory — none of it sends. The
 * model-facing tools consume this face directly; since the 3.0 redesign there
 * is no router facade in between.
 *
 * 人员目录面：浏览、解析、会话查找、自述记录与创建/补充保存路径。
 *
 * 这里的一切都只读写目录——都不发送。面向模型的工具直接消费这一面；自 3.0 重设计起，
 * 中间不再有 router 门面。
 *
 * @module @veren/im/directory
 */

import { defineToken } from '@veren/core'
import { ImError } from './contract-errors.ts'
import type { ImPersonContact } from './contract-model.ts'
import { ImBindings } from './bindings.ts'
import type { ImPeople } from './people.ts'
import type {
  ImPersonAddressFilter,
  ImPersonQuery,
  ImPersonResolution,
  ImPersonSaveRequest,
  ImPersonView,
} from './people-types.ts'

/** One create-or-enrich request for a person, optionally attaching an address. */
/** 一次人员的创建/补充请求，可选附带一个地址。 */
export interface ImPersonSaveInput {
  personId?: string
  displayName?: string
  realName?: string
  aliases?: string[]
  contacts?: ImPersonContact[]
  bio?: string
  notes?: string
  /** Drop the unverified self-report; use after recording authoritative values. */
  /** 丢弃未核实的自述；录完权威字段后使用。 */
  clearClaim?: boolean
  /** Attach one reachable address (resolves the provider through the account). */
  /** 附带一个可达地址（provider 经账号解析）。 */
  address?: {
    provider?: string
    accountId: string
    conversationId: string
    externalId?: string
    displayName?: string
  }
}

/**
 * The directory-save request mapped onto, without its address; undefined
 * fields stay untouched, exactly as the caller left them.
 * 映射成的目录保存请求，不含地址；未定义字段原样保持不动。
 */
function saveBaseOf(request: ImPersonSaveInput): ImPersonSaveRequest {
  return {
    ...(request.personId === undefined ? {} : { personId: request.personId }),
    ...(request.displayName === undefined ? {} : { displayName: request.displayName }),
    ...(request.realName === undefined ? {} : { realName: request.realName }),
    ...(request.aliases === undefined ? {} : { aliases: request.aliases }),
    ...(request.contacts === undefined ? {} : { contacts: request.contacts }),
    ...(request.bio === undefined ? {} : { bio: request.bio }),
    ...(request.notes === undefined ? {} : { notes: request.notes }),
    ...(request.clearClaim === undefined ? {} : { clearClaim: request.clearClaim }),
  }
}

/** The people-directory operations the model-facing tools consume. */
/** 面向模型的工具消费的人员目录操作。 */
export class ImDirectory {
  private readonly bindings: ImBindings
  private readonly people: ImPeople

  /**
   * @param deps - the account bindings (for provider lookups) and the directory.
   */
  constructor(deps: { bindings: ImBindings; people: ImPeople }) {
    this.bindings = deps.bindings
    this.people = deps.people
  }

  /** List or search the people directory; never sends. */
  list(request: ImPersonQuery = {}): ImPersonView[] {
    return this.people.list(request)
  }

  /** Resolve one name without sending; exposes ambiguity to the caller. */
  resolve(query: string, filter: ImPersonAddressFilter = {}): ImPersonResolution {
    return this.people.resolve(query, filter)
  }

  /**
   * Resolve the person seen at one conversation address, for tools that know
   * the conversation but not the person id.
   * 解析某个会话地址上观察到的人，供只知道会话、不知道 personId 的工具使用。
   */
  personAt(accountId: string, conversationId: string): ImPersonView | undefined {
    const account = this.bindings.account(accountId)
    if (account === undefined) return undefined
    return this.people.viewAt(account.provider, accountId, conversationId)
  }

  /** Read one person by id, for tools that already hold a personId. */
  personById(personId: string): ImPersonView | undefined {
    return this.people.person(personId)
  }

  /**
   * Record one unverified self-report from the conversation model. The
   * provider comes from the account; the claim path never touches `realName`.
   * 记录会话模型带来的一条未核实自述。provider 取自账号；claim 路径绝不碰 realName。
   */
  async reportClaim(personId: string, claim: {
    name?: string
    contacts?: ImPersonContact[]
    accountId: string
    conversationId: string
    messageId: string
  }): Promise<ImPersonView> {
    const account = this.bindings.account(claim.accountId)
    if (account === undefined) throw new ImError('IM_NOT_FOUND', `unknown account: ${claim.accountId}`)
    return this.people.recordClaim(personId, {
      ...(claim.name === undefined ? {} : { name: claim.name }),
      ...(claim.contacts === undefined ? {} : { contacts: claim.contacts }),
      provider: account.provider,
      accountId: claim.accountId,
      conversationId: claim.conversationId,
      messageId: claim.messageId,
    })
  }

  /** Create or enrich one person. An unknown account fails loudly. */
  async save(request: ImPersonSaveInput): Promise<ImPersonView> {
    const base = saveBaseOf(request)
    const address = request.address
    if (address === undefined) return this.people.save(base)
    const account = this.bindings.account(address.accountId)
    if (account === undefined) throw new ImError('IM_NOT_FOUND', `unknown account: ${address.accountId}`)
    const provider = address.provider ?? account.provider
    if (provider !== account.provider) {
      throw new ImError(
        'IM_INVALID_REQUEST',
        `account ${address.accountId} belongs to ${account.provider}, not ${provider}`,
      )
    }
    return this.people.save({
      ...base,
      address: {
        provider,
        accountId: address.accountId,
        conversationId: address.conversationId,
        ...(address.externalId === undefined ? {} : { externalId: address.externalId }),
        ...(address.displayName === undefined ? {} : { displayName: address.displayName }),
      },
    })
  }
}

/** The directory-face service token. */
/** 目录面服务的令牌。 */
export const ImDirectoryToken = defineToken<ImDirectory>('imDirectory')
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The people-directory face provided by @veren/im. */
    /** 由 @veren/im 提供的人员目录面。 */
    imDirectory: ImDirectory
  }
}
