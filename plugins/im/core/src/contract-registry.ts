/**
 * The provider registry: the `im` service token, the credential-key helper, and
 * the registry that owns provider registration and the cloud-directory attach.
 *
 * provider 注册表：`im` 服务令牌、凭据键助手，以及负责 provider 注册与云端目录挂接的
 * registry 本体。
 *
 * @module @veren/im/contract-registry
 */

import { createHash } from 'node:crypto'
import { Service } from '@deepseek-ai/cordis'
import type { Context, Disposable } from '@deepseek-ai/cordis'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import type { CredentialKey } from '@deepseek-ai/dsh-credentials'
import { defineToken } from '@veren/core'
import type { ImPeople } from './people.ts'
import { ImError } from './contract-errors.ts'
import type { ImDirectoryRemote } from './contract-directory.ts'
import type { ImMessageHandler, ImProvider } from './contract-service.ts'

/** The `im` service token. */
/** `im` 服务令牌。 */
export const ImToken = defineToken<ImRegistry>('im')
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Provider-neutral IM registry. */
    /** 渠道无关的 IM 注册表。 */
    im: ImRegistry
  }
}

/**
 * Derive the one credential key an account's secrets live under.
 *
 * The account id is hashed so ids with punctuation still satisfy the credential
 * key grammar, and so the same account always reaches the same record.
 *
 * @param accountId - provider-scoped account id.
 * @returns `im/<sha256-prefix>`.
 */
export function imCredentialKey(accountId: string): CredentialKey {
  const digest = createHash('sha256').update(accountId).digest('hex').slice(0, 32)
  // The digest is hex, so it may start with a digit; the key grammar requires a
  // leading letter, hence the stable `k` prefix.
  // 摘要是十六进制，可能以数字开头；键语法要求首字符为字母，因此加稳定的 `k` 前缀。
  return credentialKey('im', `k${digest}`)
}

/**
 * Registry of provider descriptors.
 *
 * `register` also subscribes the provider's inbound listener to the router; the
 * returned disposer removes the provider and unsubscribes in one step.
 * provider 描述符注册表。
 *
 * `register` 同时把 provider 的入站监听订阅到路由；返回的解除器一步完成移除与退订。
 */
export class ImRegistry extends Service {
  static provide = ImToken
  private readonly providers = new Map<string, { provider: ImProvider; unlisten: () => void }>()
  private directory?: ImDirectoryRemote
  /**
   * @param ctx - owning Cordis context.
   * @param onMessage - router callback receiving every inbound message.
   * @param onRegistered - fired after a provider joins; the startup
   *   reconciliation of account rows keys off this moment.
   */
  constructor(
    ctx: Context,
    private readonly onMessage: ImMessageHandler,
    private readonly onRegistered?: (provider: ImProvider) => void,
    private readonly people?: ImPeople,
  ) {
    super(ctx, ImToken)
  }
  /**
   * Attach the cloud directory (the hub-backed `ImDirectoryRemote`): people
   * observation pushes upstream, and the pulled snapshot is adopted into the
   * local people cache (when the registry was built with the people layer).
   * The disposer detaches — uninstall runs it in reverse order.
   * 挂接云端目录（hub 提供的 `ImDirectoryRemote`）：人员观察上报上游，拉到的快照由
   * 人员层采纳进本地缓存（registry 以 people 层构建时）。解除器即卸载——逆序清理。
   */
  attachDirectory(
    remote: ImDirectoryRemote,
    channel: { provider: string; accountId: string },
  ): Disposable {
    this.directory = remote
    void remote.pull()
      .then(async snapshot => {
        const adopted = await this.people?.adoptRemote(snapshot, channel)
        this.ctx.logger?.info?.(
          `[im:directory] snapshot adopted: ${adopted ?? 0} address(es) on ${channel.provider}/${channel.accountId}`,
        )
      })
      .catch((error: unknown) => {
        // 首拉失败不打断通道，但必须留痕——静默吞掉只会变成查不到的悬案。
        // A failed first pull never blocks the channel, but it must leave a
        // trace — swallowing it silently only creates an unsolvable mystery.
        this.ctx.logger?.warn?.(
          `[im:directory] first pull failed (observations still push upstream): ${
            error instanceof Error ? error.message : String(error)}`,
        )
      })
    return () => {
      if (this.directory === remote) this.directory = undefined
    }
  }
  /** The attached cloud directory, when a hub plugin provided one. */
  /** 已挂接的云端目录（hub 插件提供过才有）。 */
  directoryRemote(): ImDirectoryRemote | undefined {
    return this.directory
  }
  /**
   * Register one provider and subscribe its listener.
   * @param provider - identity, capabilities, and service.
   * @returns the disposer that removes the provider and its listener.
   */
  register(provider: ImProvider): Disposable {
    if (this.providers.has(provider.id)) {
      throw new ImError('IM_INVALID_REQUEST', `provider already registered: ${provider.id}`)
    }
    const unlisten = provider.service.listen(message => this.onMessage(provider.id, message))
    this.providers.set(provider.id, { provider, unlisten })
    // 注册即对账触发点：provider 就绪的瞬间补上启动自愈的最后一块拼图。
    // Registration doubles as the reconciliation trigger: a provider becoming
    // ready completes the startup self-heal.
    this.onRegistered?.(provider)
    return () => {
      const entry = this.providers.get(provider.id)
      if (entry === undefined) return
      this.providers.delete(provider.id)
      entry.unlisten()
    }
  }
  /**
   * Read one provider.
   * @param id - provider id.
   * @returns the registered descriptor.
   * @throws ImError `IM_NOT_FOUND` when no provider has that id.
   */
  get(id: string): ImProvider {
    const entry = this.providers.get(id)
    if (entry === undefined) throw new ImError('IM_NOT_FOUND', `unknown provider: ${id}`)
    return entry.provider
  }
  /**
   * List every registered provider in registration order.
   * @returns a fresh array of descriptors.
   */
  list(): ImProvider[] {
    return [...this.providers.values()].map(entry => entry.provider)
  }
}
