/**
 * Save path of the people directory: create-or-enrich one person and keep its
 * address rows in step. Pure row logic with no write chain of its own —
 * `PeopleMutations.save` runs it under the shared chain, so saves serialize
 * with every other mutation.
 *
 * 人员目录的保存路径：创建或补全一个人，并让地址行保持同步。这里是纯行逻辑，自身没有写链——
 * `PeopleMutations.save` 把它放在共享写链上执行，保存与其他所有变更一起串行。
 *
 * @module @veren/im/people-saves
 */

import { ImError } from './contract.ts'
import { applyProfile, contactKindOf, providerName, validatedAddressOf } from './people-text.ts'
import type { ImPersonAddressInput, ImPersonSaveRequest } from './people-types.ts'
import type { ImPersonAddressRow, ImPersonRow, ImPersonStore } from './store.ts'

/**
 * Build the fresh profile row of one newly seen or newly saved person. A
 * provider-supplied name is only a display fallback; the raw provider user id
 * is the last resort so the row is never nameless.
 * 构建一个新观察到或新保存的人的初始档案行。provider 提供的名字只是显示回退；
 * 最后回退到裸 provider 用户 id，档案行永不为空名。
 */
export function createPersonRow(
  newId: (prefix: string) => string,
  address: { provider: string; externalId: string },
  displayName: string | undefined,
  now: number,
): ImPersonRow {
  return {
    id: newId('person'),
    display_name: displayName === undefined || displayName === '' ? address.externalId : displayName,
    aliases: [],
    contacts: [{ kind: contactKindOf(address.provider), value: address.externalId }],
    updated_at: now,
  }
}

/**
 * Create or enrich one person and return the persisted row. The person row is
 * written first; its address row follows only after the profile is durable.
 * 创建或补全一个人并返回持久化后的行。先写人员行；档案落盘之后才写地址行。
 */
export async function savePersonRow(
  store: ImPersonStore,
  newId: (prefix: string) => string,
  request: ImPersonSaveRequest,
  now: number,
): Promise<ImPersonRow> {
  if (request.personId === undefined && request.address === undefined) {
    throw new ImError('IM_INVALID_REQUEST', 'personId or address is required')
  }
  const { person, address, existingAddress } = lookupSaveTarget(store, request)
  const target = person === undefined
    ? address === undefined
      ? undefined
      : newPersonRow(newId, request, address, now)
    : person
  if (target === undefined) {
    throw new ImError('IM_INVALID_REQUEST', 'address is required to create a person')
  }
  const updated = applyProfile(target, request, now)
  await store.putPerson(updated)
  if (address !== undefined && existingAddress === undefined) {
    await insertAddressRow(store, updated.id, request, address, now)
  } else if (existingAddress !== undefined && address !== undefined) {
    await refreshAddressRow(store, request, existingAddress, address, now)
  }
  return updated
}

/** Look up the person and address rows a save targets; both may be absent. */
function lookupSaveTarget(store: ImPersonStore, request: ImPersonSaveRequest): {
  person: ImPersonRow | undefined
  address: Required<Pick<ImPersonAddressInput, 'provider' | 'accountId' | 'conversationId' | 'externalId'>> | undefined
  existingAddress: ImPersonAddressRow | undefined
} {
  let person = request.personId === undefined ? undefined : store.getPerson(request.personId)
  if (request.personId !== undefined && person === undefined) {
    throw new ImError('IM_NOT_FOUND', `unknown person: ${request.personId}`)
  }
  const address = request.address === undefined ? undefined : validatedAddressOf(request.address)
  const existingAddress = address === undefined
    ? undefined
    : store.getPersonAddress(address.provider, address.accountId, address.externalId)
  if (existingAddress !== undefined) {
    if (person !== undefined && existingAddress.person_id !== person.id) {
      throw new ImError(
        'IM_INVALID_REQUEST',
        `address already belongs to person ${existingAddress.person_id}`,
      )
    }
    if (person === undefined) {
      person = store.getPerson(existingAddress.person_id)
      if (person === undefined) throw new ImError('IM_NOT_FOUND', 'the address owner is missing')
    }
  }
  return { person, address, existingAddress }
}

/** The fresh profile row of one newly saved person. */
function newPersonRow(
  newId: (prefix: string) => string,
  request: ImPersonSaveRequest,
  address: { provider: string; externalId: string },
  now: number,
): ImPersonRow {
  return createPersonRow(newId, address, providerName(request.displayName)
    ?? providerName(request.address?.displayName), now)
}

/** Insert the address row of one person's first saved address. */
async function insertAddressRow(
  store: ImPersonStore,
  personId: string,
  request: ImPersonSaveRequest,
  address: Required<Pick<ImPersonAddressInput, 'provider' | 'accountId' | 'conversationId' | 'externalId'>>,
  now: number,
): Promise<void> {
  const displayName = providerName(request.address?.displayName)
  await store.putPersonAddress({
    person_id: personId,
    provider: address.provider,
    account_id: address.accountId,
    conversation_id: address.conversationId,
    external_id: address.externalId,
    ...(displayName === undefined ? {} : { display_name: displayName }),
    updated_at: now,
  })
}

/**
 * Refresh one already-owned address row when its display name or conversation
 * drifted. Nothing is written when the row is already current.
 * 当显示名或会话漂移时刷新一条已被持有的地址行。行本身已是最新的则不写。
 */
async function refreshAddressRow(
  store: ImPersonStore,
  request: ImPersonSaveRequest,
  existingAddress: ImPersonAddressRow,
  address: Required<Pick<ImPersonAddressInput, 'provider' | 'accountId' | 'conversationId' | 'externalId'>>,
  now: number,
): Promise<void> {
  const displayName = providerName(request.address?.displayName)
  const displayChanged = displayName !== undefined && existingAddress.display_name !== displayName
  const conversationChanged = existingAddress.conversation_id !== address.conversationId
  if (displayChanged || conversationChanged) {
    await store.putPersonAddress({
      ...existingAddress,
      conversation_id: address.conversationId,
      ...(displayChanged ? { display_name: displayName } : {}),
      updated_at: now,
    })
  }
}
