/**
 * The IM remote: the plugin's web surface, as an `im` Remote namespace.
 * Deliberately thin transport: each Remote method forwards one direct service
 * call (bindings, people, intake), plus one presentation duty — a QR challenge
 * travels to the browser as a base64 data URL, so the bind flow never needs a
 * file path or the terminal.
 *
 * Room and message reads live in @veren/im-conversation's own `imConv`
 * namespace: each domain owns its transport face, and the panel mounts both.
 *
 * IM 远端：插件的 Web 面（`im` 远端命名空间）。刻意只做薄传输：每个 Remote 方法转发一次
 * 直接服务调用（绑定、人员、采集），外加一项展示职责——二维码挑战以 base64 data URL
 * 进浏览器，绑定流程从此不依赖文件路径或终端。
 *
 * 房间与消息的读取在 @veren/im-conversation 自己的 `imConv` 命名空间：每个域拥有自己的
 * 传输面，面板两个都挂载。
 *
 * @module @veren/im/remote
 */

import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { getOrThrow } from '@veren/core'
import type { ImBindChallenge, ImPersonContact, ImProvider } from './contract.ts'
import { ImError } from './contract-errors.ts'
import { ImRegistry, ImToken } from './contract-registry.ts'
import { ImBindings, ImBindingsToken } from './bindings.ts'
import { unbindAccount } from './accounts.ts'
import { ImIntakeToken } from './intake.ts'
import type { ImStrangerIntake } from './intake.ts'
import { ImPeopleToken, MAX_PERSON_LIMIT } from './people.ts'
import { ImParticipantsToken } from './participants.ts'
import type { ImPeople, ImPersonSaveRequest } from './people.ts'
import type { ImCredentialStore, ImLogger } from './runtime-seams.ts'
import { ImCredentialToken, ImLoggerToken } from './runtime-seams.ts'

/**
 * The web surface. Every collaborator arrives by injection: the same plugin's
 * apply provided them a tick earlier, and cordis resolves the tokens whenever
 * they are ready — the remote never probes a sibling (G13).
 * Web 面。所有协作者都走注入：同一插件的 apply 稍早提供了它们，cordis 在就绪时解析
 * 令牌——远端绝不探测兄弟服务（G13）。
 */
export class ImRemoteService extends TypertRemoteService {
  static inject = ['im', 'imBindings', 'imPeople', 'imIntake', 'imLogger', 'imCredentials']

  private readonly registry: ImRegistry
  private readonly bindings: ImBindings
  private readonly people: ImPeople
  private readonly intake: ImStrangerIntake
  private readonly credentials: ImCredentialStore
  private readonly logger: ImLogger

  constructor(ctx: Context) {
    super(ctx, 'imGateway', { namespace: 'im' })
    this.registry = getOrThrow(ctx, ImToken)
    this.bindings = getOrThrow(ctx, ImBindingsToken)
    this.people = getOrThrow(ctx, ImPeopleToken)
    this.intake = getOrThrow(ctx, ImIntakeToken)
    this.credentials = getOrThrow(ctx, ImCredentialToken)
    this.logger = getOrThrow(ctx, ImLoggerToken)
  }

  /**
   * One snapshot for the panel: accounts, people, intake. The address book
   * renders from this read, so it returns the directory's full ceiling rather
   * than the listing default.
   * 面板的唯一快照：账号、人员、采集。通讯录就靠这一次读取渲染，因此返回目录上限而不是列表默认值。
   */
  @Remote('catalog')
  async catalog(request: { readonly intakeLimit?: number }) {
    return {
      accounts: await this.bindings.listAccounts(),
      people: this.people.list({ limit: MAX_PERSON_LIMIT }),
      intake: this.intake.status(request?.intakeLimit ?? 10),
    }
  }

  /**
   * The participant roster: the owner, the default agent, and every preset the
   * deployment declares. The panel renders agent cards from this list, so an
   * agent appears even before it has joined a room.
   * 参与者名册：所有者、默认智能体，以及部署声明的每个 preset。面板据此渲染智能体卡片，
   * 因此一个还没进过任何房间的智能体也会出现。
   */
  @Remote('participants')
  async participants() {
    return { participants: getOrThrow(this.ctx, ImParticipantsToken).list() }
  }

  /**
   * Start one authorization attempt; the QR rides back as a data URL.
   * 发起一次授权尝试；二维码以 data URL 返回。
   */
  @Remote('beginBind')
  async beginBind(request: { readonly provider?: string; readonly label?: string }) {
    const provider = resolveProvider(this.registry, request.provider)
    const attempt = await this.bindings.beginBind(provider.id, {
      method: 'qrcode',
      ...(request.label === undefined ? {} : { label: request.label }),
    })
    return presentAttempt(attempt.bindId, attempt.status, attempt.challenge)
  }

  /** Poll one attempt; the QR rides back while the challenge is alive. */
  @Remote('pollBind')
  async pollBind(request: { readonly bindId: string }) {
    const polled = await this.bindings.pollBind(request.bindId)
    // presentAttempt 是 async：必须 await 再合并——spread 一个 Promise 得到 {}
    // / presentAttempt is async: await before merging — spreading a Promise yields {}
    const presented = await presentAttempt(polled.attempt.bindId, polled.attempt.status, polled.attempt.challenge)
    return {
      ...presented,
      ...(polled.account === undefined ? {} : { account: polled.account }),
    }
  }

  /** Submit a verification code for a needs-code attempt, then poll. */
  @Remote('submitBindCode')
  async submitBindCode(request: { readonly bindId: string; readonly code: string }) {
    const polled = await this.bindings.submitBindCode(request.bindId, request.code)
    const presented = await presentAttempt(polled.attempt.bindId, polled.attempt.status, polled.attempt.challenge)
    return {
      ...presented,
      ...(polled.account === undefined ? {} : { account: polled.account }),
    }
  }

  /** Remove an account with its credential and channel state. */
  @Remote('unbindAccount')
  async unbind(request: { readonly accountId: string }) {
    return {
      unbound: 'account' as const,
      ...await unbindAccount({
        bindings: this.bindings,
        registry: this.registry,
        credentials: this.credentials,
        people: this.people,
        logger: this.logger,
      }, request.accountId),
    }
  }

  /** List or search the people directory. */
  @Remote('people')
  async listPeople(request: { readonly query?: string }) {
    return { people: this.people.list(request.query === undefined ? {} : { query: request.query }) }
  }

  /** Set one person's display name — the panel's manual completion of the directory. */
  @Remote('renamePerson')
  async renamePerson(request: { readonly personId: string; readonly displayName: string }) {
    return {
      person: await this.people.save({
        personId: request.personId,
        displayName: request.displayName,
      }),
    }
  }

  /**
   * Create one address-book contact from a profile alone. The contact has no
   * provider address yet, so it cannot receive messages until one is attached;
   * that is exactly what a manually entered contact is.
   * 仅凭档案创建一个通讯录联系人。此人暂无 provider 地址，附上地址前不能收消息——手工录入的
   * 联系人本来就是这样。
   */
  @Remote('createPerson')
  async createPerson(request: ImPersonProfileRequest) {
    return { person: await this.people.save(profileOf(request)) }
  }

  /** Update one person's profile fields; undefined fields stay untouched. */
  @Remote('updatePerson')
  async updatePerson(request: ImPersonProfileRequest & { readonly personId: string }) {
    return {
      person: await this.people.save({ personId: request.personId, ...profileOf(request) }),
    }
  }

  /** Remove one person with their addresses and intake record. */
  @Remote('deletePerson')
  async deletePerson(request: { readonly personId: string }) {
    await this.people.remove(request.personId)
    return { deleted: request.personId }
  }

  /** Read the stranger-intake switch, counts, and recent audit records. */
  @Remote('intakeStatus')
  async intakeStatus(request: { readonly limit?: number }) {
    return { intake: this.intake.status(request?.limit ?? 20) }
  }
}

/** The editable profile fields of one person, as the panel sends them. */
/** 面板提交的一位人员的可编辑档案字段。 */
export interface ImPersonProfileRequest {
  readonly displayName?: string
  readonly realName?: string
  readonly aliases?: string[]
  readonly contacts?: ImPersonContact[]
  readonly bio?: string
  readonly notes?: string
}

/**
 * Project the panel's profile fields onto a save request; absent fields stay
 * absent so an update never clears what the caller did not mention.
 * 把面板的档案字段投影成保存请求；缺省字段保持缺省，更新永不误清调用方没提到的值。
 */
function profileOf(request: ImPersonProfileRequest): ImPersonSaveRequest {
  return {
    ...(request.displayName === undefined ? {} : { displayName: request.displayName }),
    ...(request.realName === undefined ? {} : { realName: request.realName }),
    ...(request.aliases === undefined ? {} : { aliases: request.aliases }),
    ...(request.contacts === undefined ? {} : { contacts: request.contacts }),
    ...(request.bio === undefined ? {} : { bio: request.bio }),
    ...(request.notes === undefined ? {} : { notes: request.notes }),
  }
}

/**
 * Resolve an optional provider id, defaulting only when exactly one exists.
 * 解析可选的 provider id；仅当恰好注册了一个 provider 时才允许缺省。
 */
function resolveProvider(registry: ImRegistry, id?: string): ImProvider {
  if (id !== undefined) return registry.get(id)
  const providers = registry.list()
  const first = providers[0]
  if (providers.length === 1 && first !== undefined) return first
  if (providers.length === 0) {
    throw new ImError('IM_NOT_FOUND', 'no IM provider is registered')
  }
  throw new ImError('IM_INVALID_REQUEST', 'provider is required when more than one provider is registered')
}

/**
 * Present one bind attempt to the browser: the challenge's QR file becomes a
 * data URL; the raw path never crosses the boundary.
 * 把一次绑定尝试呈现给浏览器：挑战的二维码文件转 data URL；原始路径绝不跨界。
 */
async function presentAttempt(
  bindId: string,
  status: string,
  challenge: ImBindChallenge | undefined,
): Promise<{ bindId: string; status: string; qrDataUrl?: string; expiresAt?: number }> {
  const qrDataUrl = await qrDataUrlOf(challenge?.imagePath)
  const expiresAt = challenge?.expiresAt
  return {
    bindId,
    status,
    ...(qrDataUrl === undefined ? {} : { qrDataUrl }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
  }
}

/** Read the local QR PNG as a data URL; a vanished file degrades to absent. */
/** 读取本地二维码 PNG 为 data URL；文件消失时降级为缺省。 */
async function qrDataUrlOf(path: string | undefined): Promise<string | undefined> {
  if (path === undefined) return undefined
  try {
    const png = await readFile(path)
    return `data:image/png;base64,${png.toString('base64')}`
  } catch {
    return undefined
  }
}
