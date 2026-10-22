/**
 * The toolbar dropdown's typed copy, in both locales.
 *
 * Every product-visible string the dropdown renders lives here and reaches the
 * component through the framework's `t` seat, so a missing translation is a
 * compile error rather than an English word in a Chinese page.
 *
 * 工具栏下拉的双语类型化文案。下拉渲染的每一条产品可见文案都住在这里，并经框架的
 * `t` 席位到达组件，因此漏译是编译错误，而不是中文页面里冒出的英文单词。
 * @module @veren/app-host-ui/client/locales
 */

/** Dictionary namespace owned by this plugin. */
export const NS = 'app-host-ui'

/** Every key the dropdown can render. */
export type AppPickerKey =
  | 'picker' | 'pickerAria' | 'loading' | 'failed' | 'retry' | 'noApps'
  | 'entryMissing' | 'appDisabled' | 'appBroken' | 'opening' | 'openFailed' | 'selectedApp'

/** Chinese dictionary. */
export const zh: Record<AppPickerKey, string> = {
  picker: '应用',
  pickerAria: '打开一个应用',
  loading: '正在读取应用…',
  failed: '应用目录读取失败',
  retry: '重试',
  noApps: '还没有已安装的应用',
  entryMissing: '（入口页缺失）',
  appDisabled: '（已停用）',
  appBroken: '（异常）',
  opening: '正在打开…',
  openFailed: '入口页打开失败',
  selectedApp: '已选应用（发送后开始会话）',
}

/** English dictionary. */
export const en: Record<AppPickerKey, string> = {
  picker: 'Apps',
  pickerAria: 'Open an application',
  loading: 'Reading apps…',
  failed: 'Failed to read the app catalog',
  retry: 'Retry',
  noApps: 'No installed applications yet',
  entryMissing: '(entry page missing)',
  appDisabled: '(disabled)',
  appBroken: '(broken)',
  opening: 'Opening…',
  openFailed: 'Failed to open the entry page',
  selectedApp: 'Selected app (the session starts on send)',
}
