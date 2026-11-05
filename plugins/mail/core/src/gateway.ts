/**
 * The mail gateway: the plugin's web surface, as a `mail` Remote namespace.
 *
 * Deliberately thin transport — each Remote method forwards one service call
 * and shapes its answer for the browser. The browser half mirrors these
 * endpoints in `@veren/mail-ui`; a change to a signature has exactly one
 * counterpart to follow.
 *
 * 邮件网关：插件的 Web 面，作为一个 `mail` 远端命名空间。
 *
 * 刻意只做薄传输——每个远端方法转发一次服务调用，并把答案整理成浏览器可用的形状。浏览器那半
 * 在 `@veren/mail-ui` 中镜像这些端点；签名一变，只有这一处需要跟着改。
 *
 * @module @veren/mail/gateway
 */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { getOrThrow } from '@veren/core'
import { MailServiceToken } from './service.ts'
import type { MailService, MessageView, RunView } from './service.ts'

/** The service name the browser's contribution references. / 浏览器 contribution 引用的服务名。 */
export const MAIL_GATEWAY_NAME = 'mailGateway'

/** The wire namespace the browser's contribution mounts. / 浏览器 contribution 挂载的线上命名空间。 */
export const MAIL_REMOTE_NAMESPACE = 'mail'

/**
 * The mail gateway. The service arrives by injection: the router is provided
 * by this plugin's apply a tick earlier, and cordis resolves the token
 * whenever it is ready.
 *
 * 邮件网关。服务走注入进来：由本插件的 apply 稍早提供，cordis 在就绪时解析该令牌。
 */
export class MailGatewayService extends TypertRemoteService {
  static inject = [MailServiceToken]

  private readonly mail: MailService

  /**
   * @param ctx - the owning context / 属主上下文
   */
  constructor(ctx: Context) {
    super(ctx, MAIL_GATEWAY_NAME, { namespace: MAIL_REMOTE_NAMESPACE })
    this.mail = getOrThrow(ctx, MailServiceToken)
  }

  /**
   * One snapshot for the panel: the messages and the execution chains. Remote
   * methods must take plain identifier parameters — no default, no
   * destructuring — because the Host reads parameter names from the compiled
   * signature; an omitted call still lands as `undefined`, hence the `?.`.
   *
   * 面板的一份快照：消息与执行链。远端方法的参数必须是普通标识符——不能带默认值或解构——因为
   * 宿主从编译后的签名读参数名；调用方省略参数时它以 `undefined` 落地，故用 `?.` 防御。
   */
  @Remote('catalog')
  async catalog(request: { readonly limit?: number }): Promise<{ readonly messages: MessageView[]; readonly runs: RunView[] }> {
    const messages = request?.limit === undefined
      ? this.mail.listMessages()
      : this.mail.listMessages().slice(0, request.limit)
    return { messages, runs: this.mail.listRuns() }
  }

  /** The messages one recipient holds. */
  @Remote('messages')
  async messages(request: { readonly subscriberId?: string }): Promise<MessageView[]> {
    const all = this.mail.listMessages()
    if (request?.subscriberId === undefined) return all
    return all.filter((message) => message.subscriberId === request.subscriberId)
  }

  /** The execution chains. */
  @Remote('runs')
  async runs(): Promise<RunView[]> {
    return this.mail.listRuns()
  }

  /** Mark one message as read, seen, or archived; the wrapped shape keeps an absent message representable. */
  @Remote('markMessage')
  async markMessage(request: {
    readonly messageId: string
    readonly action: 'read' | 'unread' | 'archive' | 'unarchive'
  }): Promise<{ readonly message: MessageView | undefined }> {
    return { message: await this.mail.markMessage(request.messageId, request.action) }
  }

  /** Cancel one execution chain. */
  @Remote('cancelRun')
  async cancelRun(request: { readonly transactionId: string }): Promise<{ readonly canceledJobs: number }> {
    return this.mail.cancel(request.transactionId)
  }
}
