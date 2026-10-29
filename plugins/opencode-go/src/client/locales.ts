/**
 * 登录卡片的双语文案。Bilingual copy for the sign-in card.
 *
 * @module @veren/opencode-go/client/locales
 */
export const NS = 'opencode-go'

export const zh = {
  title: 'OpenCode Go',
  signedIn: '已登录',
  notSignedIn: '未登录',
  signIn: '登录',
  reSignIn: '重新登录',
  cancel: '取消',
  close: '关闭',
  chooseMethod: '选择登录方式',
  answerPrompt: '按上方说明操作后，把内容粘贴到这里',
  submit: '提交',
  authorizedDone: '登录成功，模型已可用',
  cancelledDone: '已取消登录',
  inFlight: '登录进行中…',
  openBrowser: '请在浏览器打开上方链接完成操作',
  failed: '登录失败',
} as const

export type OgKey = keyof typeof zh

export const en: Record<OgKey, string> = {
  title: 'OpenCode Go',
  signedIn: 'Signed in',
  notSignedIn: 'Not signed in',
  signIn: 'Sign in',
  reSignIn: 'Sign in again',
  cancel: 'Cancel',
  close: 'Close',
  chooseMethod: 'Choose a sign-in method',
  answerPrompt: 'Follow the instructions above, then paste the content here',
  submit: 'Submit',
  authorizedDone: 'Signed in — the models are ready',
  cancelledDone: 'Sign-in cancelled',
  inFlight: 'Sign-in in progress…',
  openBrowser: 'Open the link above in your browser to continue',
  failed: 'Sign-in failed',
}
