/**
 * The startup page's edit drawer: the right-side container that hosts the
 * detail form while an item is being edited.
 *
 * 启动页编辑抽屉：编辑某个启动项时承载详情表单的右侧容器。
 *
 * @module @veren/startup-autostart/client/panel-drawer
 */

import { StartupDetail } from './detail.tsx'
import type { StartupDetailProps } from './detail.tsx'

/** Props of {@link EditDrawer}: everything {@link StartupDetail} needs plus the close affordance. */
export type EditDrawerProps = StartupDetailProps & { readonly onClose: () => void }

/** 编辑抽屉：右侧滑出的编辑表单容器。The edit drawer: the right-side container of the editing form. */
export function EditDrawer(props: EditDrawerProps): React.ReactElement {
  const { onClose, t, item, workspaces, choices, onUpdate, onDelete, onRun } = props
  return (
    <div className="sa-drawer-veil" onClick={onClose}>
      <aside className="sa-drawer" role="dialog" aria-label={t('panel.detail.title')}
        onClick={event => { event.stopPropagation() }}>
        <header className="sa-drawer-head">
          <span className="sa-detail-title">{t('panel.detail.title')}</span>
          <button type="button" className="sa-btn" aria-label={t('panel.detail.close')}
            onClick={onClose}>{t('panel.detail.close.short')}</button>
        </header>
        <div className="sa-drawer-body">
          {/* key 留在 StartupDetail 上：切换编辑对象时整个表单重置。 */}
          {/* The key stays on StartupDetail: switching items resets the whole form. */}
          <StartupDetail key={item.id} item={item} t={t} workspaces={workspaces} choices={choices}
            onUpdate={onUpdate} onDelete={onDelete} onRun={onRun} />
        </div>
      </aside>
    </div>
  )
}
