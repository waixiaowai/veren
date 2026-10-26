/**
 * The IM gateway: the plugin's web surface, as an `im` Remote namespace.
 * Deliberately thin transport: each Remote method forwards one router/people
 * call, plus one presentation duty — a QR challenge travels to the browser as
 * a base64 data URL, so the bind flow never needs a file path or the terminal.
 *
 * IM 网关：插件的 Web 面（`im` 远端命名空间）。刻意只做薄传输：每个 Remote 方法
 * 转发一次 router/people 调用，外加一项展示职责——二维码挑战以 base64 data URL
 * 进浏览器，绑定流程从此不依赖文件路径或终端。
 *
 * @module @veren/im/gateway-remote
 */

import { readFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { getOrThrow } from '@veren/core'
import type { ImBindChallenge } from './contract.ts'
import type { ImRouter } from './router.ts'
import { ImRouterToken } from './router.ts'

/**
 * The router arrives by injection: it is provided by the same plugin's apply
 * a tick earlier, and cordis resolves the token whenever it is ready — the
 * gateway never probes a sibling (G13).
 * router 走注入：它由同一插件的 apply 稍早提供，cordis 在就绪时解析 token——网关
 * 绝不探测兄弟服务（G13）。
 */
export class ImGatewayService extends TypertRemoteService {
  static inject = [ImRouterToken]

  private readonly router: ImRouter

  constructor(ctx: Context) {
    super(ctx, 'imGateway', { namespace: 'im' })
    this.router = getOrThrow(ctx, ImRouterToken)
  }

  /** One snapshot for the panel: accounts, bindings, conversations, people, intake. */
  @Remote('catalog')
  async catalog(request: { readonly intakeLimit?: number }) {
    const listed = await this.router.list()
    return {
      accounts: listed.accounts,
      bindings: listed.bindings,
      conversations: listed.conversations,
      people: this.router.listPeople(),
      intake: this.router.intakeStatus(request?.intakeLimit ?? 10),
    }
  }

  /**
   * Start one authorization attempt; the QR rides back as a data URL.
   * 发起一次授权尝试；二维码以 data URL 返回。
   */
  @Remote('beginBind')
  async beginBind(request: { readonly provider?: string; readonly label?: string }) {
    const provider = this.router.resolveProvider(request.provider)
    const attempt = await this.router.beginBind(provider.id, {
      method: 'qrcode',
      ...(request.label === undefined ? {} : { label: request.label }),
    })
    return presentAttempt(attempt.bindId, attempt.status, attempt.challenge)
  }

  /** Poll one attempt; the QR rides back while the challenge is alive. */
  @Remote('pollBind')
  async pollBind(request: { readonly bindId: string }) {
    const polled = await this.router.pollBind(request.bindId)
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
    const polled = await this.router.submitBindCode(request.bindId, request.code)
    const presented = await presentAttempt(polled.attempt.bindId, polled.attempt.status, polled.attempt.challenge)
    return {
      ...presented,
      ...(polled.account === undefined ? {} : { account: polled.account }),
    }
  }

  /** Bind or switch one conversation to one Session. */
  @Remote('link')
  async link(request: {
    readonly accountId: string
    readonly conversationId: string
    readonly sessionId?: string
    readonly active?: boolean
  }) {
    return { binding: await this.router.link(request) }
  }

  /** Remove one conversation binding. */
  @Remote('unbindBinding')
  async unbindBinding(request: { readonly bindingId: string }) {
    await this.router.unbindBinding(request.bindingId)
    return { unbound: 'binding' as const }
  }

  /** Remove an account with its credential and bindings. */
  @Remote('unbindAccount')
  async unbindAccount(request: { readonly accountId: string }) {
    return { unbound: 'account' as const, ...await this.router.unbindAccount(request.accountId) }
  }

  /** Change one binding's agent settings. */
  @Remote('settings')
  async settings(request: {
    readonly bindingId: string
    readonly presetId?: string
    readonly provider?: string
    readonly model?: string
    readonly reasoning?: string
  }) {
    const { bindingId, ...settings } = request
    return { binding: await this.router.settings(bindingId, settings) }
  }

  /** List or search the people directory. */
  @Remote('people')
  async people(request: { readonly query?: string }) {
    return { people: this.router.listPeople(request.query === undefined ? {} : { query: request.query }) }
  }

  /** Read the stranger-intake switch, counts, and recent audit records. */
  @Remote('intakeStatus')
  async intakeStatus(request: { readonly limit?: number }) {
    return { intake: this.router.intakeStatus(request?.limit ?? 20) }
  }
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
async function qrDataUrlOf(path: string | undefined): Promise<string | undefined> {
  if (path === undefined) return undefined
  try {
    const png = await readFile(path)
    return `data:image/png;base64,${png.toString('base64')}`
  } catch {
    return undefined
  }
}
