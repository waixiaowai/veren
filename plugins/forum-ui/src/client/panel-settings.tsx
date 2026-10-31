/**
 * The second-level settings page: the notifications card and the per-preset
 * auto-post card, stacked as the page's own view instead of a side rail. Both
 * cards start expanded; the back button returns to the list.
 *
 * 二级配置页：通知卡片与按预设的自动发帖卡片，作为页面自己的一个视图堆叠，而不是侧栏。
 * 两张卡片默认展开；返回按钮回到列表。
 *
 * @module @veren/forum-ui/client/panel-settings
 */

import { useState } from 'react'
import type { AutoPostSettings, AutoPostSnapshot, NotificationView } from './remote.ts'
import type { ForumKey } from './locales.ts'
import { ArrowLeftIcon, ChevronIcon } from './panel-kit.tsx'

/**
 * The settings page: opened by the header's config button, it stacks the
 * notifications and auto-post cards that used to sit beside the feed.
 * 配置页：由页头的配置按钮打开，堆叠原先平铺在信息流旁的通知与自动发帖卡片。
 */
export function SettingsPage(props: {
  readonly t: (key: ForumKey) => string
  readonly inbox: readonly NotificationView[]
  readonly inboxLoaded: boolean
  readonly attached: boolean
  readonly readOnly: boolean
  readonly autoPost: AutoPostSnapshot
  readonly onRead: () => void
  readonly onMarkAllRead: () => void
  readonly onSave: (settings: readonly AutoPostSettings[]) => Promise<boolean>
  readonly onBack: () => void
}) {
  const { t } = props
  const [notificationsOpen, setNotificationsOpen] = useState(true)
  const [autoPostOpen, setAutoPostOpen] = useState(true)
  return (
    <div className="forum-config">
      <button type="button" className="forum-btn forum-ghost forum-back" onClick={props.onBack}>
        <ArrowLeftIcon />
        {t('back')}
      </button>
      <div className="forum-config-head">
        <h2 className="forum-config-title">{t('config')}</h2>
        <p className="forum-config-subtitle">{t('configSubtitle')}</p>
      </div>
      <NotificationsCard
        t={t} items={props.inbox} loaded={props.inboxLoaded} attached={props.attached}
        readOnly={props.readOnly} open={notificationsOpen}
        onToggle={() => { setNotificationsOpen(!notificationsOpen) }}
        onRead={props.onRead} onMarkAllRead={props.onMarkAllRead}
      />
      <AutoPostCard
        t={t} snapshot={props.autoPost} readOnly={props.readOnly} open={autoPostOpen}
        onToggle={() => { setAutoPostOpen(!autoPostOpen) }}
        onSave={props.onSave}
      />
    </div>
  )
}

/** The notification rows plus the mark-all-read action beneath them. 通知行与行下的「全部已读」动作。 */
function NotificationList(props: {
  readonly t: (key: ForumKey) => string
  readonly items: readonly NotificationView[]
  readonly onMarkAllRead: () => void
}) {
  const { t, items, onMarkAllRead } = props
  return (
    <>
      <div className="forum-notif-list">
        {items.map(item => (
          <div key={item.id} className="forum-notif">
            <p>{item.summary}</p>
            <div className="forum-notif-meta">
              <span className={item.reason === 'mention' ? 'forum-reason' : 'forum-reason is-reply'}>
                {item.reason === 'mention' ? t('mentionsYou') : t('repliedYou')}
              </span>
              <span>{item.state === 'read' ? t('read') : t('unread')}</span>
            </div>
          </div>
        ))}
      </div>
      <button type="button" className="forum-link forum-wide" onClick={onMarkAllRead}>
        {t('markAllRead')}
      </button>
    </>
  )
}

/** The notification card, collapsible and read on demand. 通知卡片：可折叠、按需读取。 */
function NotificationsCard(props: {
  readonly t: (key: ForumKey) => string
  readonly items: readonly NotificationView[]
  readonly loaded: boolean
  readonly attached: boolean
  readonly readOnly: boolean
  readonly open: boolean
  readonly onToggle: () => void
  readonly onRead: () => void
  readonly onMarkAllRead: () => void
}) {
  const { t, items, loaded, attached, readOnly, open, onToggle, onRead, onMarkAllRead } = props
  return (
    <section className="forum-side-card">
      <button type="button" className="forum-card-head" aria-expanded={open} onClick={onToggle}>
        <span className="forum-card-title">{t('notifications')}</span>
        {items.length > 0 && <span className="forum-count">{items.length}</span>}
        <ChevronIcon />
      </button>
      {open && (
        <div className="forum-card-body">
          <button
            type="button" className="forum-btn forum-wide"
            disabled={!attached || readOnly} onClick={onRead}
          >{loaded ? t('refreshNotifications') : t('readNotifications')}</button>
          {items.length === 0
            ? <p className="forum-side-hint">{loaded ? t('noNotifications') : t('notificationsHint')}</p>
            : <NotificationList t={t} items={items} onMarkAllRead={onMarkAllRead} />}
        </div>
      )}
    </section>
  )
}

/** One preset's auto-post row: the switch, the last-run info, and the cadence input. 一个预设的自动发帖行：开关、上次运行信息与频率输入。 */
function AutoPostRow(props: {
  readonly t: (key: ForumKey) => string
  readonly setting: AutoPostSettings
  readonly lastAt: string | undefined
  readonly lastError: string | undefined
  readonly onToggle: (enabled: boolean) => void
  readonly onMinutes: (minutes: number) => void
}) {
  const { t, setting, lastAt, lastError, onToggle, onMinutes } = props
  return (
    <div className="forum-auto-row">
      <label className="forum-switch">
        <input
          type="checkbox" checked={setting.enabled} aria-label={setting.preset}
          onChange={event => { onToggle(event.target.checked) }}
        />
        <span className="forum-switch-track" aria-hidden="true" />
      </label>
      <div className="forum-auto-info">
        <span className="forum-auto-name">{setting.preset}</span>
        <span className="forum-auto-note">
          {t('lastAt')}: {lastAt ?? t('never')}
        </span>
        {lastError !== undefined && <span className="forum-form-error">{lastError}</span>}
      </div>
      <input
        className="forum-input forum-auto-min" type="number" min={1}
        aria-label={t('everyMinutes')} value={setting.everyMinutes}
        onChange={event => { onMinutes(Math.max(1, Number(event.target.value) || 1)) }}
      />
    </div>
  )
}

/** The card body: the hint, one row per preset, and the save button. 卡片体：提示、每个预设一行与保存按钮。 */
function AutoPostBody(props: {
  readonly t: (key: ForumKey) => string
  readonly snapshot: AutoPostSnapshot
  readonly settings: readonly AutoPostSettings[]
  readonly readOnly: boolean
  readonly pending: boolean
  readonly dirty: boolean
  readonly onDraft: (preset: string, setting: AutoPostSettings) => void
  readonly onSave: () => void
}) {
  const { t, snapshot, settings, readOnly, pending, dirty, onDraft, onSave } = props
  return (
    <div className="forum-card-body">
      <p className="forum-side-hint">{t('autoPostHint')}</p>
      {settings.map(setting => (
        <AutoPostRow
          key={setting.preset} t={t} setting={setting}
          lastAt={snapshot.lastAt[setting.preset]} lastError={snapshot.lastError[setting.preset]}
          onToggle={enabled => { onDraft(setting.preset, { ...setting, enabled }) }}
          onMinutes={minutes => { onDraft(setting.preset, { ...setting, everyMinutes: minutes }) }}
        />
      ))}
      <button
        type="button" className="forum-btn forum-primary forum-wide"
        disabled={readOnly || pending || !dirty} onClick={onSave}
      >{t('save')}</button>
    </div>
  )
}

/** The per-preset auto-post switches, off by default, collapsed on first paint. 按预设的自动发帖开关，默认关闭，首屏收起。 */
function AutoPostCard(props: {
  readonly t: (key: ForumKey) => string
  readonly snapshot: AutoPostSnapshot
  readonly readOnly: boolean
  readonly open: boolean
  readonly onToggle: () => void
  readonly onSave: (settings: readonly AutoPostSettings[]) => Promise<boolean>
}) {
  const { t, snapshot, readOnly, open, onToggle, onSave } = props
  const [drafts, setDrafts] = useState<Readonly<Record<string, AutoPostSettings>>>({})
  const [pending, setPending] = useState(false)
  const settings = snapshot.settings.map(setting => drafts[setting.preset] ?? setting)
  const dirty = Object.keys(drafts).length > 0
  const save = (): void => {
    setPending(true)
    void onSave(settings).then((ok) => { if (ok) setDrafts({}) }).finally(() => { setPending(false) })
  }
  return (
    <section className="forum-side-card">
      <button type="button" className="forum-card-head" aria-expanded={open} onClick={onToggle}>
        <span className="forum-card-title">{t('autoPost')}</span>
        <span className={snapshot.running ? 'forum-status is-on' : 'forum-status'}>
          {snapshot.running ? t('autoPostRunning') : t('autoPostStopped')}
        </span>
        <ChevronIcon />
      </button>
      {open && (
        <AutoPostBody
          t={t} snapshot={snapshot} settings={settings}
          readOnly={readOnly} pending={pending} dirty={dirty}
          onDraft={(preset, setting) => { setDrafts({ ...drafts, [preset]: setting }) }}
          onSave={save}
        />
      )}
    </section>
  )
}
