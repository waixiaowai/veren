/**
 * The connection settings tab: stranger intake and the CMS cloud face.
 *
 * Both used to be primary tabs (2.x). They stay here because each still owns a
 * real capability — the intake audit and the cloud directory — but neither is
 * the page's entry point any more.
 *
 * 接入设置页签：陌生人采集与 CMS 云端面。
 *
 * 两者在 2.x 都是一级页签；留在这里是因为各自仍有真实能力（采集审计、云端目录），但都不再
 * 是页面入口。
 *
 * @module @veren/im-ui/client/views-settings
 */

import type { ImKey } from './locales.ts'
import type { ImBodyProps } from './panel.tsx'
import { CloudView } from './views-cloud.tsx'
import { IntakeView } from './views-intake.tsx'

/** The settings tab body: intake first, then the cloud sign-in. */
export function SettingsView(props: ImBodyProps): React.JSX.Element {
  const t = (key: ImKey): string => props.t(key)
  return (
    <div className="im-settings">
      <h2 className="im-heading">{t('settingsHeading')}</h2>
      <p className="im-muted">{t('settingsHint')}</p>
      <IntakeView {...props} />
      <CloudView t={t} />
    </div>
  )
}
