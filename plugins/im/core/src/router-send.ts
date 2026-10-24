/**
 * Outbound send segment of the router: sends to an explicit account +
 * conversation pair, and person-targeted sends that resolve a name first.
 *
 * A person-targeted send requires exactly one person and one reachable
 * address; every other outcome refuses before any provider call. A query that
 * named an address is pinned to that address — a caller filter that excludes
 * it refuses instead of silently sending elsewhere.
 *
 * 路由的出站发送段：面向显式 account + conversation 的发送，以及先解析人名再发送的按人发送。
 *
 * 按人发送必须恰好命中一个人、一个可达地址；其他结果都在调用 provider 之前拒绝。查询点名了
 * 某个地址时就锁定该地址——调用方的过滤条件排除它时直接拒绝，绝不改发别处。
 *
 * @module @veren/im/router-send
 */

import { ImError } from './contract.ts'
import type { ImSendResult, ImRegistry } from './contract.ts'
import { ImBindings } from './bindings.ts'
import type { ImRouterSendRequest } from './runtime-seams.ts'
import { degradeContent } from './router-prompt.ts'
import type {
  ImPersonAddressFilter, ImPersonAddressView, ImPersonMatch, ImPersonResolution,
} from './people-types.ts'
import type { ImPeople } from './people.ts'
import type { ImPersonSendRequest, ImPersonSendResult } from './router-types.ts'

/** Whether one resolved address still satisfies the caller's provider/account filter. */
function addressAccepted(address: ImPersonAddressView, filter: ImPersonAddressFilter): boolean {
  return (filter.provider === undefined || address.provider === filter.provider)
    && (filter.accountId === undefined || address.accountId === filter.accountId)
}

/**
 * The outbound half of the router: explicit-target sends and person-targeted
 * sends share one resolution path and one refusal discipline.
 * 路由的出站半区：显式目标发送与按人发送共用同一条解析路径与同一种拒绝纪律。
 */
export class RouterSend {
  private readonly bindings: ImBindings
  private readonly registry: ImRegistry
  private readonly people: ImPeople

  constructor(deps: { bindings: ImBindings; registry: ImRegistry; people: ImPeople }) {
    this.bindings = deps.bindings
    this.registry = deps.registry
    this.people = deps.people
  }

  /** Send one content block to an explicit target. */
  async send(request: ImRouterSendRequest): Promise<ImSendResult> {
    const target = this.targetOf(request)
    const account = this.bindings.account(target.accountId)
    if (account === undefined) throw new ImError('IM_NOT_FOUND', `unknown account: ${target.accountId}`)
    const provider = this.registry.get(account.provider)
    const content = degradeContent(provider.features, request.content)
    return provider.service.send({
      target,
      content,
      ...(request.replyToMessageId === undefined ? {} : { replyToMessageId: request.replyToMessageId }),
    })
  }

  /**
   * Send to a person, resolving the name first. Exactly one person and one
   * address are required; every other outcome refuses before any provider call.
   * 按人发送，先解析名字。必须恰好一个人、一个地址；其他结果都在调用 provider 前拒绝。
   */
  async sendToPerson(request: ImPersonSendRequest): Promise<ImPersonSendResult> {
    const filter: ImPersonAddressFilter = {
      ...(request.provider === undefined ? {} : { provider: request.provider }),
      ...(request.accountId === undefined ? {} : { accountId: request.accountId }),
    }
    if (request.provider !== undefined) this.registry.get(request.provider)
    if (request.accountId !== undefined) {
      const account = this.bindings.account(request.accountId)
      if (account === undefined) throw new ImError('IM_NOT_FOUND', `unknown account: ${request.accountId}`)
      if (request.provider !== undefined && account.provider !== request.provider) {
        throw new ImError(
          'IM_INVALID_REQUEST',
          `account ${request.accountId} belongs to ${account.provider}, not ${request.provider}`,
        )
      }
    }
    const match = this.matchOf(request.person, this.people.resolve(request.person, filter))
    // A query that named an address is pinned to that address. If the caller's
    // filter excludes it, refuse instead of silently sending to another address.
    // 查询点名了某个地址时就锁定该地址。若调用方的过滤条件排除了它，直接拒绝，绝不改发另一个地址。
    const addresses = match.address === undefined
      ? this.people.addressesOf(match.person.id, filter)
      : addressAccepted(match.address, filter) ? [match.address] : []
    if (addresses.length === 0) {
      throw new ImError('IM_NO_ADDRESS', `no reachable address for ${match.person.displayName}`, {
        details: {
          query: request.person,
          person: match.person,
          ...(request.provider === undefined ? {} : { provider: request.provider }),
          ...(request.accountId === undefined ? {} : { accountId: request.accountId }),
        },
      })
    }
    if (addresses.length > 1) {
      throw new ImError('IM_AMBIGUOUS', `${match.person.displayName} has more than one reachable address`, {
        details: {
          query: request.person,
          reason: 'address',
          person: match.person,
          addresses,
        },
      })
    }
    const address = addresses[0]!
    const result = await this.send({
      accountId: address.accountId,
      conversationId: address.conversationId,
      content: request.content,
      ...(request.replyToMessageId === undefined ? {} : { replyToMessageId: request.replyToMessageId }),
    })
    return {
      result,
      recipient: {
        personId: match.person.id,
        displayName: match.person.displayName,
        matchedBy: match.matchedBy,
        matchedValue: match.matchedValue,
        identityStatus: match.person.identityStatus,
        ...(match.person.claimedName === undefined ? {} : { claimedName: match.person.claimedName }),
        provider: address.provider,
        accountId: address.accountId,
        conversationId: address.conversationId,
      },
    }
  }

  /** Resolve a send target from the exactly-one target form. */
  private targetOf(request: ImRouterSendRequest): { accountId: string; conversationId: string } {
    const hasBinding = request.bindingId !== undefined
    const hasPair = request.accountId !== undefined || request.conversationId !== undefined
    if (hasBinding === hasPair) {
      throw new ImError('IM_INVALID_REQUEST', 'specify bindingId or accountId + conversationId, exactly one')
    }
    const bindingId = request.bindingId
    if (bindingId !== undefined) {
      const binding = this.bindings.binding(bindingId)
      if (binding === undefined) throw new ImError('IM_NOT_FOUND', `unknown binding: ${bindingId}`)
      return { accountId: binding.accountId, conversationId: binding.conversationId }
    }
    if (request.accountId === undefined || request.conversationId === undefined) {
      throw new ImError('IM_INVALID_REQUEST', 'accountId and conversationId are both required')
    }
    return { accountId: request.accountId, conversationId: request.conversationId }
  }

  /** Turn a resolution into one match or a refusal carrying its evidence. */
  private matchOf(query: string, resolution: ImPersonResolution): ImPersonMatch {
    if (resolution.status === 'matched') return resolution.match
    if (resolution.status === 'ambiguous') {
      throw new ImError('IM_AMBIGUOUS', `more than one person matches "${query}"`, {
        details: { query, status: 'ambiguous', candidates: resolution.candidates },
      })
    }
    throw new ImError('IM_NOT_FOUND', `no person matches "${query}"`, {
      details: { query, status: 'not-found', suggestions: resolution.suggestions },
    })
  }
}
