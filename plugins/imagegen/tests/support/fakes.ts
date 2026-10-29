/** 测试替身：结构面最小的凭据/附件/网络假实现（Object.create 保持真实原型链）。 */
/** Test doubles: minimal-face fake credentials, attachments, and network (Object.create keeps the real prototype chain). */
import { AttachmentStore } from '@deepseek-ai/dsh-attachment'
import { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { ImageAttachmentRef, SaveImageAttachment } from '@deepseek-ai/dsh-attachment'
import type { CredentialKey, CredentialRecord } from '@deepseek-ai/dsh-credentials'
import type { FetchLike } from '../../src/wire.js'

/** 记录型凭据假实现：readRecord/modifyRecord 作用于内存 Map。 */
/** Recording credential fake: readRecord/modifyRecord operate on an in-memory map. */
export function fakeCredentials(records: Map<CredentialKey, CredentialRecord> = new Map()): CredentialProvider {
  const provider = Object.create(CredentialProvider.prototype) as CredentialProvider
  Object.assign(provider, {
    async readRecord(key: CredentialKey) {
      return records.get(key)
    },
    async modifyRecord(key: CredentialKey, transform: (current: CredentialRecord | undefined) => Promise<CredentialRecord>) {
      records.set(key, await transform(records.get(key)))
      return records.get(key)
    },
  })
  return provider
}

/** 入库引用假实现造出来的 ref（尺寸来自字节验证面）。 */
/** The ref a fake admission produces (dimensions come from the caller's verification face). */
export interface SavedImage {
  readonly ref: ImageAttachmentRef
  readonly input: SaveImageAttachment
}

/** 记录型附件库假实现：saveImage 原样记账并回填调用方声明的尺寸。 */
/** Recording attachment fake: saveImage records verbatim and echoes caller-declared dimensions. */
export function fakeAttachments(width = 4, height = 4): { store: AttachmentStore; saved: SavedImage[] } {
  const saved: SavedImage[] = []
  const store = Object.create(AttachmentStore.prototype) as AttachmentStore
  Object.assign(store, {
    imageLimits: {
      maxImageBytes: 50 * 1024 * 1024,
      maxImagesPerMessage: 10,
      maxMessageImageBytes: 100 * 1024 * 1024,
      maxImagePixels: 100_000_000,
      maxImageDimension: 40_000,
      mediaTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
    },
    async validateImage() {},
    async saveImage(input: SaveImageAttachment) {
      const ref: ImageAttachmentRef = {
        attachmentId: `att-${saved.length + 1}` as ImageAttachmentRef['attachmentId'],
        mediaType: input.mediaType,
        bytes: input.data.byteLength,
        width,
        height,
        ...(input.name === undefined ? {} : { name: input.name }),
      }
      saved.push({ ref, input })
      return ref
    },
  })
  return { store, saved }
}

/** 一次被记录的请求。One recorded request. */
export interface RecordedRequest {
  readonly url: string
  readonly init: RequestInit
}

/** 记录型网络假实现：handler 按调用序号应答，请求全部记账。 */
/** Recording network fake: handler answers by call index; every request is recorded. */
export function recordingFetch(handler: (index: number, call: RecordedRequest) => Response | Promise<Response>): {
  fetch: FetchLike
  calls: RecordedRequest[]
} {
  const calls: RecordedRequest[] = []
  return {
    calls,
    fetch: async (url, init) => {
      const call: RecordedRequest = { url, init }
      calls.push(call)
      return handler(calls.length - 1, call)
    },
  }
}
