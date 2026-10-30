/**
 * 登录卡片的双语文案与错误人话映射。文案归属权在客户端 locale；错误码 →
 * 人话，未知码原样透传。
 * Bilingual copy for the sign-in card plus the error-to-human map. Copy
 * ownership lives in the client locale; unknown codes pass through verbatim.
 *
 * @module @veren/workbuddy-auth/client/locales
 */
export const NS = 'workbuddy-auth'

export const zh = {
  title: 'WorkBuddy',
  signedIn: '已登录',
  notSignedIn: '未登录',
  signingIn: '登录中',
  signInCn: '登录 · 国内版（WorkBuddy）',
  signInGlobal: '登录 · 国际版（WorkBuddy AI）',
  reSignIn: '再登录一个账号',
  signOut: '退出登录',
  toggleDisable: '停用',
  toggleEnable: '启用',
  credits: '余额',
  probe: '探测档位',
  cancel: '取消',
  close: '关闭',
  retry: '重试',
  authorizedDone: '登录成功，模型已可用',
  cancelledDone: '已取消登录',
  alreadyRunning: '已有登录进行中，可继续接上或取消',
  validationFailed: '授权已拿到但目录校验未通过，凭据未保存',
  loginExpired: '授权等待超时，请重新发起',
  transportDown: '连接宿主中断',
  failed: '登录失败',
  regionCn: '国内',
  regionGlobal: '国际',
  disabledTag: '已停用',
  expiredTag: '令牌过期',
  cooldownTag: '冷却中',
  enterpriseTag: '企业',
  creditsPending: '查询中…',
  creditsNone: '无可用包',
  creditsUnlimited: '不限量',
  probeConfirmTitle: '探测将向上游发送最多 7 个真实请求并消耗积分，确定继续？',
  probeConfirmAgain: '再次确认：探测消耗真实积分，且结论只代表“上游接受该拼写”。继续？',
  probeRunning: '探测中…',
  probeValidating: '验证型，接受档位',
  probeNonValidating: '非验证型（任何值都接受，档位不可选）',
  probeUnknown: '探测未得出结论',
  creditsExhausted: '该账号额度已用尽（已自动冷却 1 小时）',
  sessionDead: '该账号登录已失效，请退出后重新登录',
  accountsTitle: '账号',
} as const

export type WbKey = keyof typeof zh

export const en: Record<WbKey, string> = {
  title: 'WorkBuddy',
  signedIn: 'Signed in',
  notSignedIn: 'Not signed in',
  signingIn: 'Signing in',
  signInCn: 'Sign in · CN (WorkBuddy)',
  signInGlobal: 'Sign in · International (WorkBuddy AI)',
  reSignIn: 'Add another account',
  signOut: 'Sign out',
  toggleDisable: 'Disable',
  toggleEnable: 'Enable',
  credits: 'Credits',
  probe: 'Probe efforts',
  cancel: 'Cancel',
  close: 'Close',
  retry: 'Retry',
  authorizedDone: 'Signed in — the models are ready',
  cancelledDone: 'Sign-in cancelled',
  alreadyRunning: 'A sign-in is already running — continue or cancel',
  validationFailed: 'Authorized, but the catalog check failed — nothing was saved',
  loginExpired: 'The authorization window timed out — start again',
  transportDown: 'Connection to the host dropped',
  failed: 'Sign-in failed',
  regionCn: 'CN',
  regionGlobal: 'Intl',
  disabledTag: 'Disabled',
  expiredTag: 'Token expired',
  cooldownTag: 'Cooling down',
  enterpriseTag: 'Enterprise',
  creditsPending: 'Checking…',
  creditsNone: 'No packages',
  creditsUnlimited: 'Unlimited',
  probeConfirmTitle: 'Probing sends up to 7 real requests and consumes credits. Continue?',
  probeConfirmAgain: 'Confirm again: probing consumes real credits and only proves the upstream accepts a spelling. Continue?',
  probeRunning: 'Probing…',
  probeValidating: 'Validating; accepted efforts',
  probeNonValidating: 'Non-validating (accepts anything; no effort picker)',
  probeUnknown: 'The probe concluded nothing',
  creditsExhausted: 'This account\u2019s credits are exhausted (cooled down for 1 hour)',
  sessionDead: 'This account\u2019s sign-in is dead — sign out and sign in again',
  accountsTitle: 'Accounts',
}

/**
 * 错误码 → 人话。code 缺失时按消息特征兜底；返回 undefined 表示按原样透传。
 * Error code → human sentence. Message fingerprints fall back when no code is
 * present; undefined passes through.
 */
export function humanizeSignInError(code: string | undefined, message: string, t: (key: WbKey) => string): string | undefined {
  if (code === 'ALREADY_IN_FLIGHT' || /already (running|an authorization)/i.test(message)) return t('alreadyRunning')
  if (code === 'SIGN_IN_VALIDATION_FAILED') return t('validationFailed')
  if (code === 'LOGIN_EXPIRED') return t('loginExpired')
  return undefined
}
