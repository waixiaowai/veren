/** Gitea outbound channel: posts issue/PR conversation comments under the agent account. */
/** Gitea 出站通道：以智能体账号发布 Issue/PR 会话评论。 */
import { z } from 'zod'
import type { OutboundMessage } from '../core/index.ts'
import { CliError } from '../infra/commands.ts'
import { sameName } from '../infra/text.ts'
import type { SourceContext } from './host.ts'
import type { ChannelLink, ChannelLinks } from './kind.ts'
import { giteaAddress, giteaPage } from './gitea-trigger.ts'

const CommentSchema = z.looseObject({
  id: z.number(), body: z.string().nullish(), in_reply_to_id: z.number().nullish(), user: z.looseObject({ login: z.string() }).nullish(),
})
/** True when an issue is permanently deleted (410) or locked (403); 404 is retried because it can indicate temporary permission loss on a private repo. */
/** Issue 被永久删除（410）或锁定（403）时为真；404 会重试，因为它可能只是私有仓库的临时权限问题。 */
const gone = (error: unknown): boolean => error instanceof CliError
  && (error.code === 410 || (error.code === 403 && /locked/i.test(error.message)))
/**
 * Posts a conversation comment with an embedded HTML marker so retries do not create duplicate comments. Gitea review
 * threads are not replied to inline in this Source: a review-thread answer goes out as a conversation comment on the PR.
 */
/** 发布带内嵌 HTML 标记的会话评论，重试不会产生重复评论。本来源不内联回复 Gitea 评审线程：评审线程的回答以 PR 会话评论发出。 */
export async function sendGitea(host: Pick<SourceContext, 'commands'>, message: OutboundMessage): Promise<'sent' | 'gone'> {
  const { commands } = host
  const gitea = commands.deployment.gitea
  if (!gitea) throw new Error('Missing Gitea deployment')
  const number = Number(message.channel.address.number)
  if (!number) throw new Error('Missing Gitea reply target')
  try {
    // Retained trigger URLs also route replies; only a comment on this exact issue/PR is recognized as ours.
    // 保留的 Trigger URL 同样参与路由；只有这条 Issue/PR 上、带本条标记的评论才被认作已发送。
    const address = giteaAddress(message.channel.address.url ?? '', gitea.host, gitea.repository)
    if (address && address.number !== number) throw new Error('Reply address does not match the configured repository entry')
    const marker = `<!-- dsh-superagent:${message.id} -->`
    const mine = (comment: z.infer<typeof CommentSchema>) => sameName(comment.user?.login ?? '', gitea.login)
      && (comment.body ?? '').includes(marker)
    const path = `issues/${number}/comments?limit=50`
    if ((await commands.giteaPages(CommentSchema, path)).some(mine)) return 'sent'
    await commands.gitea(z.unknown(), `issues/${number}/comments`, '--method', 'POST', '-f', `body=${message.text}\n\n${marker}`)
    return 'sent'
  } catch (error) {
    if (gone(error)) return 'gone'
    throw error
  }
}
export function giteaLink(address: Record<string, string>, links: ChannelLinks): ChannelLink {
  const number = address.number ?? ''
  const gitea = links.gitea
  return { url: address.url ?? (gitea ? giteaPage(gitea.host, gitea.repository, Number(number)) : ''),
    label: { zh: `Gitea #${number}`, en: `Gitea #${number}` } }
}
