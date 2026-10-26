/**
 * Write path of the people directory: observation of inbound senders, profile
 * create-or-update, self-report recording, intake persistence, and account
 * address removal — all serialized on one FIFO write chain.
 *
 * The chain is the concurrency contract: two concurrent observations of one
 * sender cannot create two profiles for the same address. Reads never queue;
 * only mutations do.
 *
 * 人员目录的写路径：入站发送者观察、档案创建/更新、自述记录、采集记录持久化与账号地址清理，
 * 全部串行在一条 FIFO 写链上。
 *
 * 写链就是并发契约：两个并发的同一发送者观察不会为同一个地址创建两份档案。读不排队，只有
 * 变更排队。
 *
 * @module @veren/im/people-writes
 */

import { randomUUID } from 'node:crypto'
import { ImError } from './contract.ts'
import type { ImMessage } from './contract.ts'
import { claimOf, normalizeText, providerName, validatedAddressOf } from './people-text.ts'
import { createPersonRow, savePersonRow } from './people-saves.ts'
import { viewOfPerson } from './people-view.ts'
import type { ImPeopleOptions, ImPersonAddressInput, ImPersonClaimInput, ImPersonSaveRequest, ImPersonView } from './people-types.ts'
import type { ImPersonAddressRow, ImPersonIntakeRow, ImPersonRow, ImPersonStore } from './store.ts'
import type { ImLogger } from './runtime-seams.ts'

/**
 * Mutation engine behind `ImPeople`. It owns the write chain; the save path
 * lives in `people-saves.ts` and runs under this same chain, so every mutation
 * still serializes here. The facade only routes writes here and serves reads
 * itself.
 * `ImPeople` 背后的变更引擎。它拥有写链；保存路径在 `people-saves.ts`，且跑在同一条写链上，
 * 全部变更仍在此串行。门面只把写路由到这里，读由门面自理。
 */
export class PeopleMutations {
  private readonly store: ImPersonStore
  private readonly logger: ImLogger
  private readonly newId: (prefix: string) => string
  private readonly now: () => number
  // Serializes writes so two concurrent observations of one sender cannot
  // create two profiles for the same address.
  // 串行化写入，两个并发的同一发送者观察不会为同一个地址创建两份档案。
  private writeChain: Promise<unknown> = Promise.resolve()

  constructor(options: ImPeopleOptions) {
    this.store = options.store
    this.logger = options.logger
    this.newId = options.newId ?? (prefix => `${prefix}_${randomUUID()}`)
    this.now = options.now ?? Date.now
  }

  /** Register the sender of one inbound message and return their person. */
  async observeMessage(providerId: string, message: ImMessage): Promise<ImPersonView | undefined> {
    const externalId = message.sender.id.trim()
    if (externalId === '') return undefined
    return this.observeConversation({
      provider: providerId,
      accountId: message.accountId,
      conversationId: message.conversationId,
      externalId,
      ...(message.sender.name === undefined ? {} : { displayName: message.sender.name }),
    })
  }

  /**
   * Register one provider address. Idempotent: the same provider user id always
   * updates the same person instead of creating a duplicate.
   * 登记一个 provider 地址。幂等：同一个 provider 用户 id 永远更新同一个人，不会创建重复记录。
   */
  observeConversation(input: ImPersonAddressInput): Promise<ImPersonView> {
    return this.write(() => this.observeNow(input))
  }

  /** Observation body, run under the write chain. */
  private async observeNow(input: ImPersonAddressInput): Promise<ImPersonView> {
    const address = validatedAddressOf(input)
    const now = this.now()
    const displayName = providerName(input.displayName)
    const existing = this.store.getPersonAddress(address.provider, address.accountId, address.externalId)
    const existingPerson = existing === undefined ? undefined : this.store.getPerson(existing.person_id)
    if (existing !== undefined && existingPerson === undefined) {
      this.logger.warn(
        `[im:people] address ${address.provider}/${address.accountId}/${address.externalId}`
        + ' referenced a missing person; the address will be reattached',
      )
    }
    // 同一外部人换了 bot 账号（重新扫码授权产生新 accountId）时，精确三元组落空
    // 会创建重复的人（真机反例：同一位用户被录成两条，采集提问重复发）。回落：
    // 同 provider 同 externalId 的旧地址归并到本次观察——地址行跟随新 accountId 漂移，
    // 人保持唯一。
    // When the exact triple misses because the human now talks through a
    // different bot account (a fresh QR authorization mints a new accountId),
    // fall back to the same provider+externalId address and let it drift to the
    // new account instead of minting a duplicate person.
    const merged = existing === undefined
      ? this.store.personAddresses().find(candidate =>
          candidate.provider === address.provider
          && candidate.external_id === address.externalId
          && candidate.account_id !== address.accountId)
      : undefined
    if (merged !== undefined) {
      const mergedPerson = this.store.getPerson(merged.person_id)
      if (mergedPerson === undefined) {
        // 悬挂地址（人已消失）：放弃归并，按全新地址登记 / a dangling address
        // (person gone): skip the merge and register fresh
        this.logger.warn(
          `[im:people] address ${merged.provider}/${merged.account_id}/${merged.external_id}`
          + ' referenced a missing person; the merge was skipped',
        )
      } else {
        this.logger.info?.(
          `[im:people] ${address.provider}/${address.externalId} moved from account`
          + ` ${merged.account_id} to ${address.accountId}; person ${merged.person_id} kept`,
        )
        const person = await this.refreshAddress(merged, mergedPerson, address, displayName, now)
        return viewOfPerson(this.store, person.id)
      }
    }
    const person = existing !== undefined && existingPerson !== undefined
      ? await this.refreshAddress(existing, existingPerson, address, displayName, now)
      : await this.registerAddress(address, displayName, now)
    return viewOfPerson(this.store, person.id)
  }

  /**
   * Refresh one known address: apply the provider-observed rename, then persist
   * the address row's own drift (display name, conversation id).
   * 刷新一个已知地址：应用 provider 观察到的改名，再持久化地址行自身的漂移（显示名、会话 id）。
   */
  private async refreshAddress(
    existing: ImPersonAddressRow,
    existingPerson: ImPersonRow,
    address: { conversationId: string },
    displayName: string | undefined,
    now: number,
  ): Promise<ImPersonRow> {
    const person = await this.observeExisting(existingPerson, existing, displayName, now)
    const displayChanged = displayName !== undefined && displayName !== ''
      && existing.display_name !== displayName
    const conversationChanged = existing.conversation_id !== address.conversationId
    if (displayChanged || conversationChanged) {
      await this.store.putPersonAddress({
        ...existing,
        conversation_id: address.conversationId,
        ...(displayChanged ? { display_name: displayName } : {}),
        updated_at: now,
      })
    }
    return person
  }

  /** Create and persist the person and address rows of one unseen address. */
  private async registerAddress(
    address: Required<Pick<ImPersonAddressInput, 'provider' | 'accountId' | 'conversationId' | 'externalId'>>,
    displayName: string | undefined,
    now: number,
  ): Promise<ImPersonRow> {
    const person = createPersonRow(this.newId, address, displayName, now)
    await this.store.putPerson(person)
    await this.store.putPersonAddress({
      person_id: person.id,
      provider: address.provider,
      account_id: address.accountId,
      conversation_id: address.conversationId,
      external_id: address.externalId,
      ...(displayName === undefined || displayName === '' ? {} : { display_name: displayName }),
      updated_at: now,
    })
    return person
  }

  /**
   * Create a person from an address, or enrich an existing person.
   *
   * An address already owned by a different person is rejected: silently
   * stealing it would make two humans share one destination.
   * 从地址创建人员，或补充已有人员。地址已属于另一个人时拒绝：静默抢占会让两个人共用一个目的地。
   */
  save(request: ImPersonSaveRequest): Promise<ImPersonView> {
    return this.write(async () => {
      const row = await savePersonRow(this.store, this.newId, request, this.now())
      return viewOfPerson(this.store, row.id)
    })
  }

  /**
   * Record one unverified self-report on a person. Authoritative fields are
   * never touched, and the first report wins: a later observation cannot
   * rewrite what the person said about themselves.
   * 在一个人身上记录一条未核实自述。权威字段永不被改动，且第一条自述生效：之后的观察不能
   * 改写对方说过的身份。
   */
  recordClaim(personId: string, input: ImPersonClaimInput): Promise<ImPersonView> {
    return this.write(() => this.claimNow(personId, input))
  }

  /** Claim body, run under the write chain. */
  private async claimNow(personId: string, input: ImPersonClaimInput): Promise<ImPersonView> {
    const person = this.store.getPerson(personId)
    if (person === undefined) throw new ImError('IM_NOT_FOUND', `unknown person: ${personId}`)
    if (person.claim !== undefined) {
      this.logger.info?.(`[im:people] person ${personId} already carries a self-report; kept the first one`)
      return viewOfPerson(this.store, personId)
    }
    const now = this.now()
    const updated: ImPersonRow = { ...person, claim: claimOf(input, now), updated_at: now }
    await this.store.putPerson(updated)
    return viewOfPerson(this.store, personId)
  }

  /** Persist one automatic-intake record through the people write chain. */
  recordIntake(row: ImPersonIntakeRow): Promise<void> {
    return this.write(() => this.store.putIntake(row))
  }

  /** Drop every address of one account after the account is removed. */
  removeAddressesOf(accountId: string): Promise<void> {
    return this.write(() => this.store.deletePersonAddressesOf(accountId))
  }

  /** Serialize every mutation so concurrent observers cannot clone a person. */
  private write<T>(work: () => Promise<T>): Promise<T> {
    const pending = this.writeChain.then(work)
    this.writeChain = pending.catch(() => undefined)
    return pending
  }

  /**
   * Apply a provider-supplied name only while the profile still carries the
   * provider's old name or the raw id; a name a human chose is never overwritten.
   * 仅当档案仍使用 provider 的旧名字或裸 id 时才写入 provider 提供的新名字；人取的名字永不被覆盖。
   */
  private async observeExisting(
    person: ImPersonRow,
    address: ImPersonAddressRow,
    displayName: string | undefined,
    now: number,
  ): Promise<ImPersonRow> {
    if (displayName === undefined || displayName === '') return person
    const current = normalizeText(person.display_name)
    const previous = address.display_name === undefined ? undefined : normalizeText(address.display_name)
    const rawId = normalizeText(address.external_id)
    const canRename = current === rawId || (previous !== undefined && current === previous)
    if (!canRename || current === normalizeText(displayName)) return person
    const updated: ImPersonRow = { ...person, display_name: displayName, updated_at: now }
    await this.store.putPerson(updated)
    return updated
  }
}
