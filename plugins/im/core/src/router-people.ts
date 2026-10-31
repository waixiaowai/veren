/**
 * People-directory face of the router: browsing, resolution, conversation
 * lookups, self-report recording, and the create-or-enrich save path.
 *
 * Everything here is read-or-write on the directory — none of it sends. The
 * facade (`router.ts`) keeps these as one-line delegations so the public
 * `ImRouter` surface is unchanged.
 *
 * 路由的人员目录面：浏览、解析、会话查找、自述记录与创建/补充保存路径。
 *
 * 这里的一切都只读写目录——都不发送。门面（`router.ts`）把这些保留为一行委托，公开的
 * `ImRouter` 面不变。
 *
 * @module @veren/im/router-people
 */
import { ImError } from './contract.ts'
import type { ImPersonContact } from './contract.ts'
import { ImBindings } from './bindings.ts'
import type { ImPeople } from './people.ts'
import type {
  ImPersonAddressFilter,
  ImPersonQuery,
  ImPersonResolution,
  ImPersonSaveRequest,
  ImPersonView,
} from './people-types.ts'
import type { ImPersonSaveInput } from './router-types.ts'

/**
 * The directory-save request a router save maps onto, without its address;
 * undefined fields stay untouched, exactly as the caller left them.
 * 路由层保存请求映射成的目录保存请求，不含地址；未定义字段原样保持不动。
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

/** The router's people-directory operations, behind the `ImRouter` facade. */
/** 路由的人员目录操作，藏在 `ImRouter` 门面之后。 */
export class RouterPeople {
  private readonly bindings: ImBindings
  private readonly people: ImPeople

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
