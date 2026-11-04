/**
 * Outbound content adaptation: downgrade or reject content the target provider
 * cannot carry, before any provider call.
 *
 * 渠道出站内容适配：在调用 provider 之前，把对方带不动的内容降级或拒绝。
 *
 * @module @veren/im/outbound
 */

import { ImError } from './contract-errors.ts'
import type { ImMessageContent } from './contract-model.ts'
import type { ImFeatures } from './contract-bind.ts'

/**
 * Downgrade or reject content the provider cannot carry. Markdown folds to
 * plain text when the channel lacks it; media the channel cannot carry is a
 * loud refusal, never a silent drop.
 * 降级或拒绝 provider 带不动的内容。渠道没有 markdown 时折叠为纯文本；渠道带不动的媒体
 * 是响亮拒绝，绝不静默丢弃。
 */
export function degradeContent(features: ImFeatures, content: ImMessageContent): ImMessageContent {
  switch (content.type) {
    case 'markdown':
      return features.markdown ? content : { type: 'text', text: content.text }
    case 'image':
      if (!features.media.image) throw new ImError('IM_UNSUPPORTED', 'this provider cannot send images')
      return content
    case 'file':
      if (!features.media.file) throw new ImError('IM_UNSUPPORTED', 'this provider cannot send files')
      if (features.limits.fileBytes !== undefined
        && content.size !== undefined
        && content.size > features.limits.fileBytes) {
        throw new ImError('IM_INVALID_REQUEST', 'the file exceeds the provider limit')
      }
      return content
    case 'text':
      return content
  }
}

/** Render one content block for a model without mixing in source metadata. */
/** 为模型渲染一个内容块，不混入来源元数据。 */
export function contentToPrompt(content: ImMessageContent): string {
  switch (content.type) {
    case 'text':
    case 'markdown':
      return content.text
    case 'image':
      return `[image: ${content.name ?? content.mime}]`
    case 'file':
      return `[file: ${content.name}]`
  }
}
