/**
 * The input-toolbar application dropdown.
 *
 * One outline-button trigger plus the shared `ui-primitives` Menu (portal,
 * dense): the list derives purely from the injected catalog snapshot, and
 * every state the user can hit — loading, read failure, empty catalog, missing
 * entry page, disabled/broken app, open failure — is an explicit row or note,
 * never a silent blank. The component holds only local view state (menu open,
 * the last failure); the open action goes back through the injected callback,
 * which resolves to a human-readable failure line or undefined on success.
 *
 * 输入工具栏的应用下拉。一个 outline 按钮触发器加共享 `ui-primitives` 的 Menu
 * （portal、dense）：列表纯派生自注入的目录快照，用户能遇到的每种状态——读取中、
 * 读取失败、目录为空、入口页缺失、应用停用/异常、打开失败——都是明确的一行或
 * 提示，绝不是静默空白。组件只持有本地视图状态（菜单开合、最近一次失败）；打开
 * 动作经注入的回调回去，回调以一行人类可读的失败文案或 undefined 兑现。
 * @module @veren/app-host-ui/client/picker
 */

import { useState } from 'react'
import { Button, IconChevronDownOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { AppCatalogSnapshot } from './catalog.ts'
import type { AppEntryView } from './remote.ts'

/** Catalog read + entry-page open, injected from the apply closure. */
export interface AppPickerInjected {
  readonly hooks: { readonly catalog: HostObservable<AppCatalogSnapshot> }
  /** Open one app's entry page; resolves to a failure line, or undefined on success. */
  readonly onOpen: (appId: string) => Promise<string | undefined>
  /** Re-read the catalog after a failed read. */
  readonly onRetry: () => void
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
  const snapshot: AppCatalogSnapshot = props.useCatalog((current) => current)
  const t = props.t
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
        void props.onOpen(id).then((failed) => {
          // 打开失败要说人话：菜单带着一行原因重新展开，而不是静默无反应。
          // Open failures speak: the menu reopens carrying one readable reason
          // line instead of silently doing nothing.
          if (failed !== undefined) {
            setFailure(failed)
            setOpen(true)
          }
        })
      }}
      onClose={() => { setOpen(false) }} />
  )
}
