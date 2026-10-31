/**
 * The cloud tab's single channel-status surface: dot + label on the left, the
 * message/people meta when online, the quiet actions (refresh cloud, sign out)
 * on the right.
 *
 * 云端页签唯一的通道状态面：左侧圆点+标签，在线时附消息/人员统计，右侧是安静动作
 * （刷新云端、登出）。
 *
 * @module @veren/im-ui/client/cloud-status-bar
 */

import type { CmsOverview } from './cms.ts'
import type { Translate } from './cloud-home-types.ts'

/** The single channel-status surface: dot + label + meta, quiet actions right. */
/** 唯一的通道状态面：圆点+标签+统计，安静动作靠右。 */
export function StatusBar(props: {
  readonly t: Translate
  readonly info: CmsOverview | undefined
  readonly authorized: boolean
  readonly onRefresh: () => void
  readonly onSignOut: () => void
}): React.JSX.Element {
  const { t, info, authorized } = props
  return (
    <div className="im-statusbar">
      <span className="im-status">
        <span className={authorized ? 'im-dot im-dot-ok' : 'im-dot'} aria-hidden="true" />
        {info === undefined ? t('cloudChecking') : authorized ? t('cloudOnline') : t('cloudUnauthorizedTitle')}
      </span>
      {authorized && info !== undefined && (
        <span className="im-statusbar-meta">
          {info.bot_id !== '' && <span className="im-id-mono">{info.bot_id}</span>}
          <span>{t('cloudStatMessages')} {info.messages}</span>
          <span>{t('cloudStatPeople')} {info.people}</span>
        </span>
      )}
      <span className="im-statusbar-actions">
        <button type="button" className="im-link-button" onClick={props.onRefresh}>{t('cloudRefresh')}</button>
        <button type="button" className="im-link-button im-link-muted" onClick={props.onSignOut}>{t('cloudLogout')}</button>
      </span>
    </div>
  )
}
