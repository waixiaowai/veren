/**
 * 规范输出值与投影：execute 只回 JSON 规范值，render 把它投影成模型面
 * `ContentBlock[]`。成功值携带真实 `ImageAttachmentRef`，render 据此产出
 * `ImageBlock`——vision 模型收回图片，文本模型由宿主投影占位文本，插件
 * 不手搓降级。错误值走同一信封（{ kind, code, message }），模型读结构。
 * Canonical output values and projections: execute returns only the JSON
 * canonical value, and render projects it into model-facing `ContentBlock[]`.
 * The success value carries the real `ImageAttachmentRef`, and render turns it
 * into an `ImageBlock` — vision models get the image back, text-only models
 * get the host-projected placeholder, and this plugin never hand-rolls the
 * downgrade. Error values share one envelope ({ kind, code, message }); the
 * model reads structure.
 *
 * @module @veren/imagegen
 */
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'

/**
 * render 读侧的错误面：code 放宽为 string（schema 面允许任意稳定码，
 * 读侧只透传不解释）。
 * The render-side error face: code widens to string (the schema face admits
 * any stable code; the read side only forwards, never interprets).
 */
export interface ErrorFace {
  readonly kind: 'error'
  readonly code: string
  readonly message: string
}

/** attachment 字段在规范值里的结构面（运行时对象即真实 ref）。 */
/** The structural face of the attachment field inside the canonical value (the runtime object IS the real ref). */
export interface AttachmentValue {
  readonly attachmentId: string
  readonly mediaType: string
  readonly bytes: number
  readonly width: number
  readonly height: number
  readonly name?: string
}

/** 成功值：落盘路径、尺寸、字节数、持久引用与 chroma 统计。 */
/** The success value: save path, dimensions, byte count, durable ref, and chroma stats. */
export interface SavedValue {
  readonly kind: 'saved'
  readonly path: string
  readonly width: number
  readonly height: number
  readonly bytes: number
  readonly mediaType: string
  readonly attachment: AttachmentValue
  readonly model: string
  readonly prompt: string
  readonly chroma?: { readonly key: string; readonly transparent: number; readonly total: number }
}

/** 两个工具共用的规范输出值（读侧）。The canonical output value shared by both tools (the read side). */
export type ImagegenValue = SavedValue | ErrorFace

/**
 * 把规范值里的 attachment 结构面还原为真实 `ImageAttachmentRef`：值在保存时
 * 就是 saveImage 返回的那个对象，schema 面只是把它投影成 JSON 字段；brand
 * 是零开销标记，此处的还原不改变任何运行时值。
 * Restores the real `ImageAttachmentRef` from the value's structural face: the
 * value IS the object saveImage returned, the schema face merely projects it
 * into JSON fields; the brand is a zero-cost marker, so this restoration never
 * mutates any runtime value.
 */
function asAttachmentRef(value: AttachmentValue): ImageAttachmentRef {
  return value as ImageAttachmentRef
}

/** 成功值的人类可读文本面（模型与用户都可读）。The success value's human-readable text face (readable by model and user). */
export function describeSaved(value: SavedValue): string {
  const chroma = value.chroma === undefined
    ? ''
    : ` chroma key ${value.chroma.key} removed ${value.chroma.transparent}/${value.chroma.total} pixels.`
  return `Saved ${value.path} (${value.width}x${value.height}, ${value.bytes} bytes, model ${value.model}).${chroma}`
}

/** 规范值 → 模型面内容：成功 = 文本 + ImageBlock；错误 = 文本。 */
/** Canonical value → model-facing content: success = text plus an ImageBlock; error = text. */
export function renderValue(_args: unknown, value: ImagegenValue): ContentBlock[] {
  if (value.kind === 'error') {
    return [{ type: 'text', text: JSON.stringify(value) }]
  }
  return [
    { type: 'text', text: describeSaved(value) },
    { type: 'image', attachment: asAttachmentRef(value.attachment) },
  ]
}

/** 一次调用的纯 pending 卡片。The pure pending card of one call. */
export function pendingCard(title: string, rawInput: unknown): GenericCallView {
  return { card: 'generic', title, kind: 'other', ...(rawInput === undefined ? {} : { rawInput }) }
}
