/**
 * The channel providers: the things that actually put a message somewhere.
 *
 * Two ship here. The station inbox writes the message into the durable store
 * and nothing else — no external call, no credential, no failure mode beyond
 * the write itself. That makes it the one channel that always resolves, and
 * the one the web panel reads.
 *
 * The SMTP provider talks to a mail server and reports back what the server
 * said. A rejection from the server is a terminal failure: the address was
 * wrong or the account is blocked, and sending again changes nothing. A
 * timeout is the opposite — transient, and worth another attempt.
 *
 * 渠道提供方：真正把消息送到某处的东西。
 *
 * 这里提供两个。站内收件箱只把消息写进持久化存储，此外别无他事——无外呼、无凭据、除写入本身
 * 外无失败模式。这使它成为唯一总能解析的渠道，也是 Web 面板读取的那一个。
 *
 * SMTP 提供方与邮件服务器对话，并回报服务器说了什么。服务器拒绝是终态失败：地址有误或账号被
 * 封禁，再发一次毫无改变。超时则相反——瞬时，值得再试一次。
 *
 * @module @veren/mail/providers
 */

import nodemailer, { type Transporter } from 'nodemailer'
import type {
  ChannelProvider,
  DeliveryReceipt,
  DeliveryRequest,
} from './deliver.ts'
import type { ChannelKind } from './types.ts'

/**
 * The station inbox provider. It accepts every message and delivers it to
 * nobody outside the host — the durable store is the delivery.
 *
 * 站内收件箱提供方。它受理每一条消息，且不向宿主之外投递任何东西——持久化存储就是投递本身。
 */
export const inAppProvider: ChannelProvider = {
  providerId: 'in_app',
  channels: ['in_app'],
  send(request: DeliveryRequest): Promise<DeliveryReceipt> {
    return Promise.resolve({ accepted: true, warning: request.content.length === 0 })
  },
}

/** The configuration one SMTP integration carries. / 一条 SMTP 集成所携带的配置。 */
export interface SmtpConfig {
  /** The mail server's host. / 邮件服务器主机。 */
  readonly host: string
  /** The mail server's port. / 邮件服务器端口。 */
  readonly port: number
  /** Whether the connection is TLS from the start. / 连接是否一开始就启用 TLS。 */
  readonly secure: boolean
  /** The sender address. / 发件地址。 */
  readonly from: string
  /** The account name, when the server requires one. / 账户名（服务器要求时）。 */
  readonly user?: string
  /** The account password, when the server requires one. / 账户密码（服务器要求时）。 */
  readonly password?: string
}

/**
 * Build the SMTP provider for one integration.
 *
 * @param config - the integration's mail-server configuration / 该集成的邮件服务器配置
 * @param createTransport - the transport factory, so a test can substitute one / 传输工厂，测试可替换
 * @returns the provider / 提供方
 */
export function smtpProvider(
  config: SmtpConfig,
  createTransport: (options: SmtpConfig) => Transporter = defaultTransport,
): ChannelProvider {
  const transport = createTransport(config)
  return {
    providerId: 'smtp',
    channels: ['email'],
    async send(request: DeliveryRequest): Promise<DeliveryReceipt> {
      try {
        await transport.sendMail({
          from: config.from,
          to: request.address,
          ...(request.subject === undefined ? {} : { subject: request.subject }),
          text: request.content,
        })
        return { accepted: true }
      } catch (error: unknown) {
        return classifySmtpError(error)
      }
    },
  }
}

/**
 * Build the transport one configuration describes.
 *
 * @param config - the mail-server configuration / 邮件服务器配置
 * @returns the transport / 传输
 */
function defaultTransport(config: SmtpConfig): Transporter {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    ...(config.user === undefined ? {} : { auth: { user: config.user, pass: config.password ?? '' } }),
  })
}

/**
 * Classify one SMTP failure.
 *
 * A timeout is transient and worth another attempt; everything else the
 * server says is final. The message is not echoed into the receipt's error
 * text beyond the server's own summary — the content is already recorded.
 *
 * 归类一次 SMTP 失败。
 *
 * 超时是瞬时的，值得再试；服务器说的其他一切都是终态。回执的错误文本不回显超过服务器自身的
 * 摘要——内容已被记录。
 *
 * @param error - the thrown value / 抛出的值
 * @returns the receipt describing the failure / 描述该失败的回执
 */
function classifySmtpError(error: unknown): DeliveryReceipt {
  const code = readCode(error)
  if (code === 'ETIMEDOUT' || code === 'ECONNECTION' || code === 'ESOCKET') {
    return {
      accepted: false,
      errorId: 'MAIL_DELIVER_PROVIDER_TIMEOUT',
      errorText: code,
      retryable: true,
    }
  }
  return {
    accepted: false,
    errorId: 'MAIL_DELIVER_PROVIDER_REJECTED',
    errorText: code,
    retryable: false,
  }
}

/**
 * Read the transport's own error code, when it has one.
 *
 * 读取传输自身的错误码（若有）。
 *
 * @param error - the thrown value / 抛出的值
 * @returns the error code, or a generic marker / 错误码，或通用标记
 */
function readCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code
    if (typeof code === 'string') return code
  }
  return error instanceof Error ? error.message : String(error)
}

/**
 * The channels this module's providers serve.
 *
 * 本模块提供方所服务的渠道。
 */
export const PROVIDED_CHANNELS: readonly ChannelKind[] = ['in_app', 'email']
