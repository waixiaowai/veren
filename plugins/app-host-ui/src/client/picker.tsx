/**
 * The input-toolbar application dropdown.
 *
 * One outline-button trigger plus the shared `ui-primitives` Menu (portal,
 * dense): the list derives purely from the injected catalog snapshot, and
 * every state the user can hit — loading, read failure, empty catalog, missing
 * entry page, disabled/broken app, open failure — is an explicit row or note,
 * never a silent blank. The component holds only local view state (menu open,
 * the last failure, the resolved app); the staging action goes back through the
 * injected callback, which resolves to a human-readable failure line or
 * undefined on success.
 *
 * 输入工具栏的应用下拉。一个 outline 按钮触发器加共享 `ui-primitives` 的 Menu
 * （portal、dense）：列表纯派生自注入的目录快照，用户能遇到的每种状态——读取中、
 * 读取失败、目录为空、入口页缺失、应用停用/异常、打开失败——都是明确的一行或
 * 提示，绝不是静默空白。组件只持有本地视图状态（菜单开合、最近一次失败、已解析
 * 的应用）；暂存动作经注入的回调回去，回调以一行人类可读的失败文案或 undefined 兑现。
 * @module @veren/app-host-ui/client/picker
 */

import { useEffect, useState } from 'react'
import { Button, IconChevronDownOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// 类型-only import：拉取 ui-session 对 SessionStandardProps 的声明合并——会话作用域
// 的 slot 在运行时拿到 `sessionId`（本组件据此判定"当前会话属于哪个应用"）。
// type-only import: pulls ui-session's SessionStandardProps merge — session-scoped
// slots receive `sessionId` at runtime (used to resolve the owning app).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { AppCatalogSnapshot } from './catalog.ts'
import type { AppEntryView } from './remote.ts'

/** Catalog read + app staging, injected from the apply closure. */
export interface AppPickerInjected {
  readonly hooks: { readonly catalog: HostObservable<AppCatalogSnapshot> }
  /** Stage one app on the current session; resolves to a failure line, or undefined on success. */
  readonly onStage: (appId: string, sessionId: string) => Promise<string | undefined>
  /** Re-read the catalog after a failed read. */
  readonly onRetry: () => void
  /** The app owning one session (a page session or a staged pick), or null for an ordinary session. */
  readonly resolveApp: (sessionId: string) => Promise<AppEntryView | null>
}

/** Props of {@link AppPicker}, derived from the framework shares. */
export type AppPickerProps = PropsRuntime<'conversation.input.left'>
  & InjectFace<AppPickerInjected>
  & PropsLocale<'app-host-ui'>

/** The localized `t` seat. */
type T = PropsLocale<'app-host-ui'>['t']

/** One app row's suffix note: why it cannot open, localized. */
function appNote(app: AppEntryView, t: T): string {
  if (app.entryUrl === undefined) return ` ${t('entryMissing')}`
  if (app.state === 'disabled') return ` ${t('appDisabled')}`
  if (app.state === 'broken') return ` ${t('appBroken')}`
  return ''
}

/** The menu body shown while the catalog is not (yet) a list of apps. */
function StatusRows(props: { snapshot: AppCatalogSnapshot; t: T; onRetry: () => void }): React.ReactElement {
  const { snapshot, t } = props
  if (snapshot.state === 'loading') return <div className="ah-picker-status">{t('loading')}</div>
  if (snapshot.state === 'failed') {
    return (
      <div className="ah-picker-status">
        <span>{t('failed')}: {snapshot.error?.code ?? ''} {snapshot.error?.message ?? ''}</span>
        <Button variant="outline" size="sm" onClick={props.onRetry}>{t('retry')}</Button>
      </div>
    )
  }
  return <div className="ah-picker-status">{t('noApps')}</div>
}

/**
 * Render the application dropdown.
 * @param props - derived framework shares: catalog hook face, callbacks, locale.
 * @returns the trigger button with its portaled app menu.
 */
export function AppPicker(props: AppPickerProps): React.ReactElement {
  const [open, setOpen] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  // 当前会话所属应用：页面会话显示"已选应用"并锁定（不再给下拉），普通会话保持
  // 下拉。undefined = 解析中（渲染等宽占位，避免先闪一下下拉）。
  // The app owning the current session: a page session shows and locks
  // "selected app" (no dropdown); an ordinary session keeps the dropdown.
  // undefined = resolving (render a same-size placeholder instead of flashing
  // the dropdown).
  const [owner, setOwner] = useState<AppEntryView | null | undefined>(undefined)
  const sessionId = props.sessionId
  useEffect(() => {
    let alive = true
    setOwner(undefined)
    // 解析失败退回下拉：显示能力可以缺席，但绝不阻塞输入栏。
    // / a failed resolve falls back to the dropdown: the display may be absent,
    // but it must never block the input bar.
    void props.resolveApp(sessionId).then(
      (app) => { if (alive) setOwner(app) },
      () => { if (alive) setOwner(null) },
    )
    return () => { alive = false }
  }, [sessionId])
  const snapshot: AppCatalogSnapshot = props.useCatalog((current) => current)
  const t = props.t
  if (owner !== undefined && owner !== null) {
    // 已选应用：静态标识，不可再次更改（会话 ↔ 应用页一一绑定）
    // / the selected app: a static mark, no longer changeable (session ↔ app page bind one-to-one)
    return (
      <span className="ah-picker-static" title={t('selectedApp')} aria-label={`${t('selectedApp')}: ${owner.name}`}>
        <span className="ah-picker-value">{owner.name}</span>
      </span>
    )
  }
  if (owner === undefined) return <span className="ah-picker-ghost" aria-hidden="true" />
  const hasApps = snapshot.apps.length > 0
  return (
    <Menu portal dense compact autoFocus
      open={open}
      anchor={
        <Button variant="outline" size="sm" className="ah-picker"
          aria-label={t('pickerAria')} aria-haspopup="menu" aria-expanded={open}
          onClick={() => { setOpen(true) }}>
          <span className="ah-picker-value">{t('picker')}</span>
          <IconChevronDownOutlineRegular />
        </Button>
      }
      items={hasApps
        ? snapshot.apps.map((app) => ({ id: app.id, label: `${app.name}${appNote(app, t)}` }))
        : []}
      children={
        hasApps
          ? (failure === undefined
              ? undefined
              : <div className="ah-picker-status">{t('openFailed')}: {failure}</div>)
          : <StatusRows snapshot={snapshot} t={t} onRetry={props.onRetry} />
      }
      onSelect={(id) => {
        setFailure(undefined)
        void props.onStage(id, sessionId).then((failed) => {
          // 打开失败要说人话：菜单带着一行原因重新展开，而不是静默无反应。
          // Open failures speak: the menu reopens carrying one readable reason
          // line instead of silently doing nothing.
          if (failed !== undefined) {
            setFailure(failed)
            setOpen(true)
            return
          }
          // 暂存成功：立刻显示"已选应用"；会话要等用户发送首条消息才真正开始。
          // / staged: show the selected app right away; the session really starts
          // when the user sends the first message.
          setOpen(false)
          setOwner(snapshot.apps.find((app) => app.id === id) ?? null)
        })
      }}
      onClose={() => { setOpen(false) }} />
  )
}
