/**
 * The detail pane's local draft: the editable subset of an item held as strings
 * so inputs stay controlled, the diffing that sends only what moved, and the
 * client-side validation mirroring the Host's required-field rules.
 *
 * The pane edits this draft and never writes on its own: a save goes through
 * the injected `onUpdate`, which reaches `startup/update`.
 *
 * 详情面板的本地草稿：以字符串持有启动项的可编辑子集，让输入保持受控；以及只提交
 * 变更字段的差异比对，和与宿主必填规则一致的客户端校验。
 *
 * 面板只编辑草稿，不会自行写入：保存走注入的 `onUpdate` → `startup/update`。
 *
 * @module @veren/startup-autostart/client/detail-draft
 */

import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { StartupModelOption } from './choices.ts'
import type { StartupItemRequest, StartupItemView } from './remote.ts'

/** The editable subset of an item, held as strings so inputs stay controlled. */
export interface Draft {
  readonly name: string
  readonly enabled: boolean
  readonly action: StartupItemView['action']
  readonly message: string
  readonly sessionId: string
  readonly workspaceId: string
  readonly preset: string
  /** Select key of the pinned model route; empty means unset. */
  readonly modelKey: string
}

/** Change one draft field; the pane clears its status note alongside. */
export type EditDraft = <K extends keyof Draft>(key: K, value: Draft[K]) => void

/** The select key that identifies one model route. */
export function modelKeyOf(model: { readonly provider: string; readonly model: string } | undefined): string {
  return model === undefined ? '' : `${model.provider}\u0000${model.model}`
}

/** The request target behind one select key, or `undefined` when unset. */
function modelTargetOf(key: string, models: readonly StartupModelOption[]): StartupItemRequest['model'] {
  if (key === '') return undefined
  const found = models.find(option => modelKeyOf(option) === key)
  return found === undefined ? undefined : { provider: found.provider, model: found.model }
}

/** Seed a draft from the committed item. */
export function draftOf(item: StartupItemView): Draft {
  return {
    name: item.name,
    enabled: item.enabled,
    action: item.action,
    message: item.message ?? '',
    sessionId: item.sessionId ?? '',
    workspaceId: item.workspaceId ?? '',
    preset: item.preset ?? '',
    modelKey: modelKeyOf(item.model),
  }
}

/**
 * Collect only the fields the draft changed, so an untouched field keeps its
 * stored value on the Host and a concurrent edit elsewhere survives.
 *
 * A field is omitted rather than sent as `undefined`, and a cleared target is
 * sent as an empty string, which the Host reads as "remove this target".
 * @param item - committed item the draft started from.
 * @param draft - current draft values.
 * @returns the update request for `startup/update`.
 */
export function changedFields(
  item: StartupItemView,
  draft: Draft,
  models: readonly StartupModelOption[],
): StartupItemRequest & { readonly id: string } {
  const committed = draftOf(item)
  /** Spread a field only when the draft actually moved it. */
  const when = <K extends keyof Draft>(key: K): Partial<Pick<Draft, K>> =>
    draft[key] === committed[key] ? {} : { [key]: draft[key] } as Pick<Draft, K>
  // The Host has no "clear model" verb, so the form only ever sends a route:
  // the unset entry is not rendered while the item pins one.
  // 宿主没有"清除模型"动词，因此表单只会提交路由：已设模型时不渲染未设置项。
  const nextModel = modelTargetOf(draft.modelKey, models) ?? item.model
  const model = draft.modelKey === committed.modelKey || nextModel === undefined
    ? {}
    : { model: nextModel }
  return {
    id: item.id,
    ...when('name'),
    ...when('enabled'),
    ...when('action'),
    ...when('message'),
    ...when('sessionId'),
    ...when('workspaceId'),
    ...when('preset'),
    ...model,
  }
}

/**
 * Client-side validation mirroring the Host's required-field rules, so a save
 * is rejected with a readable message before it ever reaches `startup/update`.
 * 与宿主必填规则一致的客户端校验：不满足时先给出可读提示，不发出 `startup/update`。
 * @param draft - current draft values.
 * @param t - locale resolver for the error copy.
 * @returns the first violation's message, or `undefined` when the draft is valid.
 */
export function validateDraft(draft: Draft, t: PropsLocale<'startup.panel'>['t']): string | undefined {
  if (draft.name.trim() === '') return t('panel.detail.error.nameRequired')
  // Session id is required by every action except creating a brand-new session.
  // 除新建会话外，其余动作都要求会话 id。
  if (draft.action !== 'new_session' && draft.sessionId.trim() === '') {
    return t('panel.detail.error.sessionRequired')
  }
  // The host requires a message body for wake and queue actions.
  // 宿主要求唤醒与投递动作必须携带消息正文。
  if ((draft.action === 'message_session' || draft.action === 'queue_message') && draft.message.trim() === '') {
    return t('panel.detail.error.messageRequired')
  }
  return undefined
}
