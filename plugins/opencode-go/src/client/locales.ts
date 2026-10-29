/**
 * 登录卡片的双语文案与错误人话映射。
 * 文案归属权在客户端 locale（method.id → 键、错误码 → 人话），流程里的
 * 开发者标签只做语义兜底；内部凭据键名绝不外泄。
 * Bilingual copy for the sign-in card plus the error-to-human map.
 * Copy ownership lives in the client locale (method.id → key, error code →
 * human sentence); the flow's developer labels are semantic fallbacks only,
 * and internal record keys never leak.
 *
 * @module @veren/opencode-go/client/locales
 */
export const NS = 'opencode-go'

export const zh = {
  title: 'OpenCode Go',
  signedIn: '已登录',
  notSignedIn: '未登录',
  signingIn: '登录中',
  signIn: '登录',
  reSignIn: '重新登录',
  signOut: '退出登录',
  cancel: '取消',
  close: '关闭',
  continueAttach: '继续',
  methodConsoleKey: '从 opencode.ai/auth 创建并粘贴 API key',
  methodImportLocal: '导入本机 opencode CLI 已登录的 key',
  answerPrompt: '按上方说明操作后，把内容粘贴到这里',
  submit: '提交',
  authorizedDone: '登录成功，模型已可用',
  cancelledDone: '已取消登录',
  alreadyRunning: '已有登录进行中，可继续接上或取消',
  keyInvalid: 'key 未通过校验，请重试',
  quotaExhausted: '套餐配额已用尽',
  failed: '登录失败',
  pasteManually: '手动粘贴 key',
  waitingBrowser: '已在浏览器打开 opencode.ai/auth；若本机 CLI 已登录将自动获取 key',
  autoTimedOut: '未检测到本机 CLI 登录。可先运行 opencode auth login opencode，或改用手动粘贴',
  autoImported: '已自动获取 key（来自本机 CLI）',
  transportDown: '连接宿主中断',
  retry: '重试',
} as const

export type OgKey = keyof typeof zh

export const en: Record<OgKey, string> = {
  title: 'OpenCode Go',
  signedIn: 'Signed in',
  notSignedIn: 'Not signed in',
  signingIn: 'Signing in',
  signIn: 'Sign in',
  reSignIn: 'Sign in again',
  signOut: 'Sign out',
  cancel: 'Cancel',
  close: 'Close',
  continueAttach: 'Continue',
  methodConsoleKey: 'Create a key at opencode.ai/auth and paste it here',
  methodImportLocal: 'Import the key the local opencode CLI is signed in with',
  answerPrompt: 'Follow the instructions above, then paste the content here',
  submit: 'Submit',
  authorizedDone: 'Signed in — the models are ready',
  cancelledDone: 'Sign-in cancelled',
  alreadyRunning: 'A sign-in is already running — continue or cancel',
  keyInvalid: 'The key was rejected — try again',
  quotaExhausted: 'The plan quota is exhausted',
  failed: 'Sign-in failed',
  pasteManually: 'Paste a key manually',
  waitingBrowser: 'Opened opencode.ai/auth in your browser; the key imports automatically once this machine\u2019s CLI is signed in',
  autoTimedOut: 'No CLI login detected. Run opencode auth login opencode first, or paste manually',
  autoImported: 'Key imported automatically (from the local CLI)',
  transportDown: 'Connection to the host dropped',
  retry: 'Retry',
}

/**
 * 错误码 → 人话。code 缺失时按消息特征兜底（网关对部分错误的 code 映射
 * 不保证）；返回 undefined 表示按原样透传。
 * Error code → human sentence. With no code, message fingerprints fall back
 * (the gateway's code mapping is not guaranteed); undefined passes through.
 */
export function humanizeSignInError(code: string | undefined, message: string, t: (key: OgKey) => string): string | undefined {
  if (code === 'ALREADY_IN_FLIGHT' || /already (running|an authorization)/i.test(message)) return t('alreadyRunning')
  if (code === 'KEY_INVALID' || /invalid credential/i.test(message)) return t('keyInvalid')
  if (code === 'QUOTA_EXCEEDED') return t('quotaExhausted')
  return undefined
}
