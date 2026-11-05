/**
 * The five-layer preference merge.
 *
 * The design fixes the layer order and the merge semantics, and both are
 * load-bearing:
 *
 * 1. `workflow_resource` — the workflow's own default, shared by all recipients.
 * 2. `user` — the operator's setting on the workflow.
 * 3. `subject_global` — the recipient's global setting.
 * 4. `subject_workflow` — the recipient's setting for this workflow.
 * 5. `subscription` — the group-level setting for this subscription.
 *
 * Later layers override earlier ones. A layer marked `readOnly` truncates the
 * merge rather than being ignored: the read-only layer and everything before
 * it survive, and everything after it is dropped — because a lower layer that
 * may not override is a ceiling, not a suggestion. A `critical` workflow skips
 * only the three recipient-controlled layers; a read-only ceiling still binds
 * it.
 *
 * 五层偏好合并。
 *
 * 设计固定了层序与合并语义，二者都是承重的：
 *
 * 1. `workflow_resource`——工作流自身的默认值，全体收件人共享。
 * 2. `user`——运营者在该工作流上的设置。
 * 3. `subject_global`——收件人的全局设置。
 * 4. `subject_workflow`——收件人对该工作流的设置。
 * 5. `subscription`——该订阅关系上的分组级设置。
 *
 * 后面的层覆盖前面的层。被标记 `readOnly` 的层是截断而非忽略：该只读层及其之前各层保留，
 * 其后各层被丢弃——不可被覆盖的下层是天花板，不是建议。`critical` 工作流只跳过三个由收件人
 * 控制的层；只读天花板对它仍然生效。
 *
 * @module @veren/mail/preference
 */

import type {
  ChannelKind,
  PreferenceLayer,
  PreferenceRecord,
  PreferenceSchedule,
} from './types.ts'

/** The merge order, fixed and not configurable. / 固定的合并顺序，不可配置。 */
export const PREFERENCE_LAYER_ORDER: readonly PreferenceLayer[] = [
  'workflow_resource',
  'user',
  'subject_global',
  'subject_workflow',
  'subscription',
]

/** The layers a recipient controls; a critical workflow skips exactly these. / 收件人控制的层；critical 工作流恰好跳过这些。 */
const RECIPIENT_LAYERS: ReadonlySet<PreferenceLayer> = new Set<PreferenceLayer>([
  'subject_global',
  'subject_workflow',
  'subscription',
])

/** The channels a merge may leave open. / 合并后可能保持开放的渠道。 */
const ALL_CHANNELS: readonly ChannelKind[] = ['in_app', 'email', 'sms', 'chat', 'push', 'tool']

/**
 * One layer's contribution to the merge, together with the scope it was
 * recorded under. The scope fields decide whether the layer applies at all.
 *
 * 一个层对合并的贡献，连同它被记录时所处的作用域。作用域字段决定该层是否适用。
 */
export interface PreferenceLayerInput {
  /** Which layer this is. / 该层是哪一层。 */
  readonly layer: PreferenceLayer
  /** The workflow this layer was recorded against. / 该层记录时针对的工作流。 */
  readonly workflowId?: string
  /** The recipient this layer was recorded against. / 该层记录时针对的收件人。 */
  readonly subscriberId?: string
  /** The group this layer was recorded against. / 该层记录时针对的分组。 */
  readonly topicKey?: string
  /** The context keys this layer is partitioned under. / 该层所处的上下文键分区。 */
  readonly contextKeys: readonly string[]
  /** Whether the recipient is messaged at all. / 是否给收件人发消息。 */
  readonly enabled: boolean
  /** Whether lower layers may override this one. / 下层是否可覆盖本层。 */
  readonly readOnly: boolean
  /** Per-channel overrides; absent means "inherit". / 按渠道的覆盖；缺省即继承。 */
  readonly channels: Readonly<Partial<Record<ChannelKind, boolean>>>
  /** The quiet window, when this layer sets one. / 该层设置的静默窗口。 */
  readonly schedule?: PreferenceSchedule
}

/** What a merge needs to know about one recipient. / 一次合并需要知道的收件人信息。 */
export interface PreferenceSubject {
  /** The recipient's identifier. / 收件人标识。 */
  readonly subscriberId: string
  /** The groups this recipient is subscribed to. / 该收件人订阅的分组。 */
  readonly topicKeys: readonly string[]
}

/** What one merge decides. / 一次合并的判定结果。 */
export interface PreferenceDecision {
  /** Whether the recipient may be messaged at all. / 是否可以给该收件人发消息。 */
  readonly send: boolean
  /** The channels that remain open. / 仍然开放的渠道。 */
  readonly channels: readonly ChannelKind[]
  /** The quiet window, when one applies. / 生效的静默窗口。 */
  readonly window?: PreferenceSchedule
  /** Which layer settled the decision. / 决定本次判定的层。 */
  readonly decidedBy: PreferenceLayer | 'default'
}

/** What one merge is computed for. / 一次合并针对的对象。 */
export interface PreferenceScope {
  /** The workflow being delivered. / 被投递的工作流。 */
  readonly workflowId: string
  /** The recipient. / 收件人。 */
  readonly subject: PreferenceSubject
  /** The context keys in force. / 生效的上下文键。 */
  readonly contextKeys: readonly string[]
  /** The group the delivery came through, when it came through one. / 投递所经的分组（若有）。 */
  readonly topicKey?: string
  /** Whether the workflow bypasses recipient preferences. / 该工作流是否绕过收件人偏好。 */
  readonly critical: boolean
}

/**
 * Merge the layers into one decision.
 *
 * @param scope - what the merge is computed for / 合并针对的对象
 * @param layers - the stored layers, in any order / 已存储的层，顺序任意
 * @returns the merged decision / 合并后的判定
 */
export function mergePreferences(
  scope: PreferenceScope,
  layers: readonly PreferenceLayerInput[],
): PreferenceDecision {
  const applicable = applicableLayers(scope, layers)
  const surviving = truncateAtReadOnly(applicable)
  const settings = mergeChannels(surviving)
  const decidedBy = surviving.at(-1)?.layer ?? 'default'
  if (!settings.enabled) {
    return { send: false, channels: [], decidedBy }
  }
  const window = surviving.map((layer) => layer.schedule).findLast((schedule) => schedule !== undefined)
  return {
    send: true,
    channels: ALL_CHANNELS.filter((channel) => settings.channels[channel] !== false),
    ...(window === undefined ? {} : { window }),
    decidedBy,
  }
}

/**
 * The layers that apply to this scope, in merge order. A critical workflow
 * drops the three recipient-controlled layers; a layer recorded against a
 * different workflow, recipient, or group is out of scope entirely.
 *
 * 适用于本作用域的层，按合并顺序。critical 工作流丢弃三个收件人层；记录在其他工作流、
 * 收件人或分组下的层完全不参与。
 *
 * @param scope - what the merge is computed for / 合并针对的对象
 * @param layers - the stored layers, in any order / 已存储的层，顺序任意
 * @returns the applicable layers in merge order / 按合并顺序的适用层
 */
function applicableLayers(
  scope: PreferenceScope,
  layers: readonly PreferenceLayerInput[],
): PreferenceLayerInput[] {
  const scoped = layers.filter((layer) => matchesScope(scope, layer))
  const allowed = scope.critical
    ? scoped.filter((layer) => !RECIPIENT_LAYERS.has(layer.layer))
    : scoped
  return PREFERENCE_LAYER_ORDER
    .map((layer) => allowed.find((candidate) => candidate.layer === layer))
    .filter((layer): layer is PreferenceLayerInput => layer !== undefined)
}

/**
 * Whether one layer belongs to this scope: the same workflow, recipient and
 * group where the layer names them, and intersecting context keys.
 *
 * 某个层是否属于本作用域：该层指明的工作流、收件人、分组须一致，且上下文键相交。
 *
 * @param scope - what the merge is computed for / 合并针对的对象
 * @param layer - the candidate layer / 候选层
 * @returns whether the layer applies / 该层是否适用
 */
function matchesScope(scope: PreferenceScope, layer: PreferenceLayerInput): boolean {
  if (layer.workflowId !== undefined && layer.workflowId !== scope.workflowId) return false
  if (layer.subscriberId !== undefined && layer.subscriberId !== scope.subject.subscriberId) return false
  if (layer.topicKey !== undefined && layer.topicKey !== scope.topicKey) return false
  if (layer.layer === 'subscription' && scope.topicKey === undefined) return false
  return intersects(layer.contextKeys, scope.contextKeys)
}

/**
 * Truncate the merge at the earliest read-only layer. That layer and every
 * layer before it survive; everything after is dropped.
 *
 * 在最早的只读层处截断合并。该层及其之前各层保留，其后各层丢弃。
 *
 * @param layers - the applicable layers, in merge order / 按合并顺序的适用层
 * @returns the surviving layers / 保留下来的层
 */
function truncateAtReadOnly(layers: readonly PreferenceLayerInput[]): PreferenceLayerInput[] {
  const index = layers.findIndex((layer) => layer.readOnly)
  return index < 0 ? [...layers] : layers.slice(0, index + 1)
}

/**
 * Fold the surviving layers into one channel decision. A channel absent from
 * every layer stays open — absence means "inherit", and the inherited value
 * is open.
 *
 * 把保留下来的层折叠成一份渠道判定。某渠道在所有层中都缺省即保持开放——缺省意为「继承」，
 * 而继承到的值是开放。
 *
 * @param layers - the surviving layers, in merge order / 按合并顺序的保留下来的层
 * @returns the merged enabled flag and per-channel switches / 合并后的启用标志与按渠道开关
 */
function mergeChannels(layers: readonly PreferenceLayerInput[]): {
  readonly enabled: boolean
  readonly channels: Readonly<Partial<Record<ChannelKind, boolean>>>
} {
  let enabled = true
  const channels: Partial<Record<ChannelKind, boolean>> = {}
  for (const layer of layers) {
    enabled = enabled && layer.enabled
    for (const [channel, value] of Object.entries(layer.channels)) {
      if (value === undefined) continue
      channels[channel as ChannelKind] = value
    }
  }
  return { enabled, channels }
}

/**
 * Whether two context-key sets intersect. An empty set on either side means
 * the default slot, which intersects everything.
 *
 * 两个上下文键集合是否相交。任一侧为空即默认槽位，与一切相交。
 *
 * @param left - the first set / 第一组
 * @param right - the second set / 第二组
 * @returns whether they intersect / 是否相交
 */
function intersects(left: readonly string[], right: readonly string[]): boolean {
  if (left.length === 0 || right.length === 0) return true
  return left.some((key) => right.includes(key))
}

/**
 * Project a stored record into the merge's layer input.
 *
 * 把已存储记录投影成合并所用的层输入。
 *
 * @param record - the stored layer / 已存储的层
 * @returns the layer input / 层输入
 */
export function toLayerInput(record: PreferenceRecord): PreferenceLayerInput {
  return {
    layer: record.layer,
    ...(record.workflowId === undefined ? {} : { workflowId: record.workflowId }),
    ...(record.subscriberId === undefined ? {} : { subscriberId: record.subscriberId }),
    ...(record.topicKey === undefined ? {} : { topicKey: record.topicKey }),
    contextKeys: record.contextKeys,
    enabled: record.enabled,
    readOnly: record.readOnly,
    channels: record.channels ?? {},
    ...(record.schedule === undefined ? {} : { schedule: record.schedule }),
  }
}
