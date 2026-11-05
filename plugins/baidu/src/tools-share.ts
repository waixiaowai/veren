/**
 * 分享工具：把授权根内的文件/目录创建为私密分享。链接一律透传服务端
 * 返回，本地不拼接；提取码缺省随机生成（4 位），有效期缺省 7 天。
 * The share tool: creates a private share for files/directories inside the
 * authorized root. Links pass through from the server verbatim — never
 * assembled locally; the password defaults to a random 4-char code and the
 * period to 7 days.
 *
 * @module @veren/baidu-pan
 */
import { randomInt } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { baiduPanError } from './errors.js'
import { createShare } from './share.js'
import { displayPath, foldErrors, outputOneOf, resolveEntries, textBlock } from './toolkit.js'
import type { BaiduPanWorld } from './world.js'

/** ok 规范值的 schema 面（分享）。The ok value's schema face (share). */
const SHARE_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    kind: { type: 'string', required: true, const: 'ok' },
    link: { type: 'string', required: true },
    shortUrl: { type: 'string' },
    password: { type: 'string', required: true },
    period: { type: 'integer', required: true },
    paths: { type: 'array', required: true, items: { type: 'string' } },
  },
} as const

/** 随机提取码：4 位数字与小写字母。A random password: 4 digits/lowercase letters. */
function randomPassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'
  let password = ''
  for (let index = 0; index < 4; index += 1) password += alphabet[randomInt(alphabet.length)]
  return password
}

/** 渲染：链接 + 提取码 + 有效期，路径只作说明。Renders: link + password + period, with paths as the caption. */
function renderShare(value: unknown): string {
  const data = value as { kind?: string; link?: string; password?: string; period?: number; paths?: string[] }
  if (data.kind !== 'ok') return JSON.stringify(value)
  const period = data.period === 0 ? '永久 / permanent' : `${data.period ?? 7} 天`
  const caption = (data.paths ?? []).map(path => displayPath(path)).join('、')
  return `分享已创建 / share created（${caption}）：\n${data.link ?? ''}\n提取码 / password: ${data.password ?? ''}（有效期 ${period}）`
}

/**
 * 在当前作用域注册分享工具；逆序清理，随作用域卸载不泄漏。
 * Registers the share tool on the calling scope; reverse-order disposal,
 * no leak when the scope unloads.
 */
export function registerShareTool(ctx: Context, world: BaiduPanWorld): () => void {
  return ctx.tools.register(defineTool({
    name: 'baidu_pan__share',
      timeoutMs: 120_000,
    description: 'Create a private Baidu Netdisk share link for one or more paths inside the authorized root. Returns the link, a 4-char extraction password and the validity period. Creating a share exposes the content to anyone holding link+password — confirm the user actually wants the share before calling.',
    parameters: {
      paths: { type: 'array', required: true, items: { type: 'string' }, description: 'Paths to share, inside the authorized root' },
      period: { type: 'integer', enum: [0, 1, 7, 30], description: 'Validity in days: 0 permanent, else 1/7/30; default 7' },
      password: { type: 'string', description: '4-char extraction password (digits/lowercase); a random one by default' },
    },
    output: { schema: outputOneOf(SHARE_SCHEMA), render: (_args, value) => textBlock(renderShare(value)) },
    execute: foldErrors(async (args: { paths?: readonly string[]; period?: number; password?: string }) => {
      const paths = args.paths ?? []
      if (paths.length === 0) throw baiduPanError('BDPAN_INVALID_ARG', { detail: 'paths is empty' })
      const entries = await resolveEntries(world, paths)
      const password = args.password ?? randomPassword()
      const receipt = await createShare(world.client, {
        fsids: entries.map(entry => entry.fsid),
        period: args.period ?? 7,
        password,
      })
      return {
        kind: 'ok' as const,
        link: receipt.link,
        ...(receipt.shortUrl === undefined ? {} : { shortUrl: receipt.shortUrl }),
        password: receipt.password,
        period: receipt.period,
        paths: entries.map(entry => entry.path),
      }
    }),
  }))
}
