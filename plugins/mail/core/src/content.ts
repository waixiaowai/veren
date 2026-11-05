/**
 * The content pipeline: render a step's template, wrap it in a layout, and
 * sanitize the result.
 *
 * The design fixes the order — validate, fill variables, render the body,
 * wrap it, sanitize, clamp — and the order matters. Sanitizing before
 * rendering would let a template smuggle markup past the filter; rendering
 * before sanitizing is what makes the whitelist the last word on the content
 * that actually leaves the plugin.
 *
 * Two template engines, never mixed within one render: the body uses Liquid,
 * the layout uses Handlebars. The body is the caller's data flowing into
 * text; the layout is operator-authored chrome around it, and the two have
 * different escaping needs.
 *
 * 内容流水线：渲染步骤模板、套上布局、并对结果做清洗。
 *
 * 设计固定了顺序——校验、补齐变量、渲染正文、套布局、清洗、截断——且顺序重要。先清洗后渲染
 * 会让模板把标记绕过过滤器；先渲染后清洗才使白名单成为内容离开插件前最后一道关卡。
 *
 * 两个模板引擎，绝不在一次渲染内混用：正文用 Liquid，布局用 Handlebars。正文是调用方的数据
 * 流入文本；布局是运营者写的外壳，二者转义需求不同。
 *
 * @module @veren/mail/content
 */

import { Liquid } from 'liquidjs'
import Handlebars from 'handlebars'
import sanitizeHtml from 'sanitize-html'
import { mailError } from './errors.ts'
import type { StepContent } from './types.ts'

/**
 * The tags a rendered body may carry. The list is the ordinary structure of
 * an HTML mail — headings, lists, tables, and the sectioning elements a
 * layout wraps them in — and nothing that can execute.
 *
 * 渲染后正文允许携带的标签。该列表是 HTML 邮件的常见结构——标题、列表、表格，以及布局用来
 * 包裹它们的分区元素——不含任何可执行的东西。
 */
const ALLOWED_TAGS = [
  'a', 'article', 'aside', 'b', 'blockquote', 'br', 'caption', 'code', 'col',
  'colgroup', 'dd', 'div', 'dl', 'dt', 'em', 'figcaption', 'figure', 'footer',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'i', 'img', 'li', 'main',
  'mark', 'nav', 'ol', 'p', 'pre', 's', 'section', 'small', 'span', 'strong',
  'sub', 'sup', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'u', 'ul',
]

/** The attributes a rendered body may carry. / 渲染后正文允许携带的属性。 */
const ALLOWED_ATTRIBUTES = {
  a: ['href', 'title', 'target', 'rel'],
  img: ['src', 'alt', 'title', 'width', 'height'],
  '*': ['style', 'class'],
}

/** The URL schemes a rendered body may link to. / 渲染后正文允许链接的 URL 协议。 */
const ALLOWED_SCHEMES = ['http', 'https', 'mailto']

/** What one render produces. / 一次渲染的产出。 */
export interface RenderedContent {
  /** The sanitized body. / 清洗后的正文。 */
  readonly body: string
  /** The subject line, when the channel carries one. / 标题行，渠道支持时存在。 */
  readonly subject?: string
}

/** The engine used to render step bodies. / 渲染步骤正文所用的引擎。 */
const liquid = new Liquid({ strictVariables: false, strictFilters: false })

/**
 * Render a step's content and sanitize the result.
 *
 * @param content - the step's template / 步骤的模板
 * @param payload - the business payload / 业务载荷
 * @param options - the layout and locale, when the channel uses them / 布局与语言（渠道使用时）
 * @returns the rendered, sanitized content / 渲染并清洗后的内容
 */
export async function renderContent(
  content: StepContent,
  payload: Readonly<Record<string, unknown>>,
  options: { readonly layout?: string; readonly locale?: string } = {},
): Promise<RenderedContent> {
  const rendered = await liquid.parseAndRender(content.body, { ...payload, locale: options.locale ?? 'en' })
  const body = await applyLayout(rendered, options.layout, payload)
  const safe = sanitize(body)
  const subject = content.subject === undefined
    ? undefined
    : sanitize(await liquid.parseAndRender(content.subject, { ...payload, locale: options.locale ?? 'en' }))
  return { body: safe, ...(subject === undefined ? {} : { subject }) }
}

/**
 * Wrap a rendered body in the layout, when one is given. A layout failure is
 * a render failure — a half-wrapped body must not be delivered.
 *
 * 用布局包裹渲染后的正文（若给了布局）。布局失败即渲染失败——半包裹的正文不得投递。
 *
 * @param body - the rendered body / 渲染后的正文
 * @param layout - the layout template / 布局模板
 * @param payload - the business payload / 业务载荷
 * @returns the wrapped body / 包裹后的正文
 */
async function applyLayout(
  body: string,
  layout: string | undefined,
  payload: Readonly<Record<string, unknown>>,
): Promise<string> {
  if (layout === undefined) return body
  try {
    return Handlebars.compile(layout, { strict: false })({ ...payload, body })
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error)
    throw mailError('MAIL_DELIVER_TEMPLATE_RENDER_FAILED', `mail: the layout failed to render: ${detail}`)
  }
}

/**
 * Sanitize rendered HTML against the whitelist. There is no switch to turn
 * this off: an unsanitized body is how injected markup reaches a recipient.
 *
 * 按白名单清洗渲染后的 HTML。这里没有关闭开关：未清洗的正文正是注入标记抵达收件人的途径。
 *
 * @param html - the rendered HTML / 渲染后的 HTML
 * @returns the sanitized HTML / 清洗后的 HTML
 */
export function sanitize(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: ALLOWED_ATTRIBUTES,
    allowedSchemes: ALLOWED_SCHEMES,
    disallowedTagsMode: 'discard',
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'noopener noreferrer' }, true),
    },
  })
}

/**
 * Render a template without the sanitizer, for preview surfaces that never
 * leave the host. Still refuses to execute anything: the output is text.
 *
 * 渲染模板但不做清洗，供绝不离开宿主的预览面使用。仍拒绝执行任何东西：产出只是文本。
 *
 * @param template - the template / 模板
 * @param payload - the business payload / 业务载荷
 * @returns the rendered text / 渲染后的文本
 */
export async function renderPreview(
  template: string,
  payload: Readonly<Record<string, unknown>>,
): Promise<string> {
  try {
    return await liquid.parseAndRender(template, payload)
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : String(error)
    throw mailError('MAIL_DELIVER_TEMPLATE_RENDER_FAILED', `mail: the template failed to render: ${detail}`)
  }
}
