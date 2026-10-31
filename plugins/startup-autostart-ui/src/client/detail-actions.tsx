/**
 * The detail pane's action row and its delete confirmation: save, revert, run
 * now, and the two-step delete.
 *
 * Buttons stay disabled while an operation is in flight, and the save/revert
 * pair also waits for a dirty draft, so a click can never send a no-op.
 *
 * 详情面板的操作行与删除确认：保存、放弃修改、立即运行，以及两步删除。
 *
 * 操作进行中所有按钮都会禁用，保存与放弃还会等待有变更的草稿，因此点击永远不会发出
 * 空操作。
 *
 * @module @veren/startup-autostart/client/detail-actions
 */

import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { StartupItemView } from './remote.ts'
import type { StartupDetailPane } from './detail-state.ts'

/** The pane's four affordances: save, revert, run now, and delete. */
export function DetailButtons(props: {
  readonly pane: StartupDetailPane
  readonly t: PropsLocale<'startup.panel'>['t']
}): React.ReactElement {
  const { pane, t } = props
  return (
    <div className="sa-actions">
      <button type="button" className="sa-btn sa-btn-primary" disabled={pane.busy || !pane.dirty} onClick={() => { void pane.save() }}>
        {pane.busy ? t('panel.detail.saving') : t('panel.detail.save')}
      </button>
      <button type="button" className="sa-btn" disabled={pane.busy || !pane.dirty} onClick={pane.revert}>
        {t('panel.detail.revert')}
      </button>
      <button type="button" className="sa-btn" disabled={pane.busy} onClick={() => { void pane.run() }}>
        {pane.busy ? t('panel.detail.running') : t('panel.detail.run')}
      </button>
      <button type="button" className="sa-btn sa-btn-danger" disabled={pane.busy} onClick={() => { pane.setConfirming(true) }}>
        {t('panel.detail.delete')}
      </button>
    </div>
  )
}

/** The confirmation the delete button opens; the delete itself stays one click away. */
export function DeleteConfirm(props: {
  readonly item: StartupItemView
  readonly pane: StartupDetailPane
  readonly t: PropsLocale<'startup.panel'>['t']
}): React.ReactElement {
  const { pane, t } = props
  return (
    <div className="sa-actions" role="alertdialog" aria-label={t('panel.detail.deleteConfirm', { name: props.item.name })}>
      <span className="sa-note">{t('panel.detail.deleteConfirm', { name: props.item.name })}</span>
      <button type="button" className="sa-btn sa-btn-danger" disabled={pane.busy} onClick={() => { void pane.remove() }}>
        {t('panel.detail.deleteYes')}
      </button>
      <button type="button" className="sa-btn" disabled={pane.busy} onClick={() => { pane.setConfirming(false) }}>
        {t('panel.detail.deleteNo')}
      </button>
    </div>
  )
}
