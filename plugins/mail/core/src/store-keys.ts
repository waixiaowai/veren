/**
 * The storage keys: how each record's identifier becomes a key the backend
 * accepts.
 *
 * The medium is a key-value store, and in the `per-record` layout a key
 * becomes a path segment. That alphabet is narrower than the identifiers
 * callers use — a subscriber id may contain `/`, `.`, or non-ASCII text. Each
 * key segment is therefore hex encoded, which keeps arbitrary identifiers
 * inside the safe alphabet while staying deterministic: the same identifier
 * always yields the same key, so a lookup is a direct read rather than a scan.
 *
 * 存储键：记录的标识如何变成后端接受的键。
 *
 * 介质是键值存储，在 `per-record` 布局下键会成为路径片段。那套字符集比调用方使用的标识更窄
 * ——收件人标识可能含 `/`、`.` 或非 ASCII 文本。因此每个键段都做十六进制编码：既把任意标识
 * 收进安全字符集，又保持确定性——同一标识永远产出同一键，因此查找是直接读取而非扫描。
 *
 * @module @veren/mail/store-keys
 */

/** Separator between two hex-encoded key segments. / 两个十六进制键段之间的分隔符。 */
const KEY_SEPARATOR = '_'

/**
 * Encode one key segment into lower-case hex.
 * @param value - the raw segment / 原始键段
 * @returns the hex-encoded segment / 十六进制编码后的键段
 */
export function encodeKeySegment(value: string): string {
  return Buffer.from(value, 'utf8').toString('hex')
}

/**
 * Build a composite key from its segments.
 * @param segments - the raw segments, in order / 按序排列的原始键段
 * @returns the path-safe composite key / 路径安全的复合键
 */
export function compositeKey(...segments: readonly string[]): string {
  return segments.map(encodeKeySegment).join(KEY_SEPARATOR)
}

/** The key a subscriber profile is stored under. / 收件人档案的存储键。 */
export function subscriberKey(subscriberId: string): string {
  return encodeKeySegment(subscriberId)
}

/** The key a workflow definition is stored under. / 工作流定义的存储键。 */
export function workflowKey(workflowId: string): string {
  return encodeKeySegment(workflowId)
}

/** The key a group is stored under. / 分组的存储键。 */
export function topicKeyOf(topicKey: string): string {
  return encodeKeySegment(topicKey)
}

/**
 * The key a subscription relationship is stored under. Both sides are
 * encoded, so the pair is unambiguous regardless of what the identifiers
 * contain.
 *
 * 订阅关系的存储键。两侧都编码，因此无论标识含什么，这一对都不会混淆。
 *
 * @param topicKey - the group key / 分组标识
 * @param subscriberId - the subscriber identifier / 收件人标识
 * @returns the composite key / 复合键
 */
export function subscriptionKey(topicKey: string, subscriberId: string): string {
  return compositeKey(topicKey, subscriberId)
}

/**
 * The key a preference layer is stored under. The layer discriminator comes
 * first so a scan for one layer never crosses into another.
 *
 * 偏好层的存储键。层判别符在前，因此扫描某一层时绝不会越界到另一层。
 *
 * @param layer - the layer discriminator / 层判别符
 * @param scope - the scope identifiers, in a fixed order / 作用域标识，顺序固定
 * @returns the composite key / 复合键
 */
export function preferenceKey(layer: string, ...scope: readonly string[]): string {
  return compositeKey(layer, ...scope)
}

/** The key an execution chain is stored under. / 执行链的存储键。 */
export function runKey(runId: string): string {
  return encodeKeySegment(runId)
}

/** The key a step instance is stored under. / 步骤实例的存储键。 */
export function jobKey(jobId: string): string {
  return encodeKeySegment(jobId)
}

/** The key a delivered message is stored under. / 已投递消息的存储键。 */
export function messageKey(messageId: string): string {
  return encodeKeySegment(messageId)
}

/** The key a conversation is stored under. / 会话的存储键。 */
export function conversationKey(conversationId: string): string {
  return encodeKeySegment(conversationId)
}

/** The key a conversation message is stored under. / 会话消息的存储键。 */
export function conversationEventKey(conversationId: string, eventId: string): string {
  return compositeKey(conversationId, eventId)
}

/** The key an execution fact is stored under. / 执行事实的存储键。 */
export function factKey(factId: string): string {
  return encodeKeySegment(factId)
}
