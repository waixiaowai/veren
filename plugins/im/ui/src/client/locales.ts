/**
 * The IM page's typed copy, in both locales.
 *
 * Every product-visible string the page renders lives here and reaches the
 * components through the framework's `t` seat, so a missing translation is a
 * compile error rather than an English word in a Chinese page.
 *
 * IM 页面的双语类型化文案。
 *
 * 页面渲染的每一条产品可见文案都住在这里，并通过框架的 `t` 座位到达组件，因此漏译是编译
 * 错误，而不是中文页面里冒出一个英文词。
 *
 * @module @veren/im-ui/client/locales
 */

/** Dictionary namespace owned by this plugin. */
export const NS = 'im'

/** Every key the IM page can render. */
export type ImKey =
  | 'panel' | 'panelSubtitle' | 'refresh' | 'loading' | 'failed' | 'retry'
  | 'tabAccounts' | 'tabConversations' | 'tabPeople' | 'tabIntake'
  | 'accounts' | 'noAccounts' | 'provider' | 'statusOnline' | 'statusOffline' | 'bindWechat'
  | 'bindTitle' | 'bindScanHint' | 'bindPending' | 'bindScanned' | 'bindNeedsCode' | 'bindBound'
  | 'bindExpired' | 'bindFailed' | 'bindQrMissing' | 'codePlaceholder' | 'submitCode' | 'closeWizard'
  | 'unbindAccount' | 'confirmUnbindAccount'
  | 'conversations' | 'noConversations' | 'conversationsHint' | 'pendingSuffix'
  | 'statusQueued' | 'statusConsuming' | 'statusReplied' | 'statusFailed' | 'statusDead'
  | 'people' | 'noPeople' | 'peopleHint' | 'unverifiedClaim'
  | 'unnamedPerson' | 'rename' | 'renamePlaceholder' | 'save' | 'cancel'
  | 'intake' | 'intakeOn' | 'intakeOff' | 'intakeCounts' | 'intakeRecent' | 'noIntakeRows'
  | 'askedAt' | 'intakePerson' | 'errorPrefix'

/** Chinese dictionary. */
export const zh: Record<ImKey, string> = {
  panel: '消息',
  panelSubtitle: '微信账号、会话绑定与人员目录，一页看全。',
  refresh: '刷新',
  loading: '正在读取…',
  failed: '读取失败',
  retry: '重试',
  tabAccounts: '账号',
  tabConversations: '会话',
  tabPeople: '人员',
  tabIntake: '采集',
  accounts: '账号',
  noAccounts: '还没有已授权的账号。',
  provider: '渠道',
  statusOnline: '在线',
  statusOffline: '离线',
  bindWechat: '绑定微信',
  bindTitle: '扫码授权',
  bindScanHint: '打开微信扫一扫，扫这个二维码并在手机上确认。',
  bindPending: '等待扫码…',
  bindScanned: '已在手机上扫描，请在手机上确认…',
  bindNeedsCode: '需要验证码：请在手机上查看并输入',
  bindBound: '授权成功。',
  bindExpired: '二维码已过期，请重新发起。',
  bindFailed: '授权失败。',
  bindQrMissing: '二维码图片缺失：点「重新发起」再试一次。',
  codePlaceholder: '手机上显示的验证码',
  submitCode: '提交验证码',
  closeWizard: '收起',
  unbindAccount: '移除账号',
  confirmUnbindAccount: '再点一次确认移除（连同凭据与会话记录）',
  conversations: '会话',
  noConversations: '还没有会话记录。',
  conversationsHint: '每个微信会话由网关私有一个 DSH 会话；消息排队处理，按序回复。',
  pendingSuffix: '条排队中',
  statusQueued: '排队中',
  statusConsuming: '处理中',
  statusReplied: '已回复',
  statusFailed: '重试中',
  statusDead: '已放弃',
  people: '人员目录',
  noPeople: '还没有人员记录。',
  peopleHint: '发来消息的陌生人会自动收录；名字与联系方式可由采集对话或手动补全。',
  unverifiedClaim: '自称',
  unnamedPerson: '微信用户',
  rename: '备注',
  renamePlaceholder: '填一个你认得出的名字',
  save: '保存',
  cancel: '取消',
  intake: '陌生人采集',
  intakeOn: '已开启：陌生人第一次发消息会收到一条询问',
  intakeOff: '已关闭：不发询问，也不写采集记录',
  intakeCounts: '询问中',
  intakeRecent: '最近记录',
  noIntakeRows: '还没有采集记录。',
  askedAt: '询问于',
  intakePerson: '人员',
  errorPrefix: '出错',
}

/** English dictionary. */
export const en: Record<ImKey, string> = {
  panel: 'Messages',
  panelSubtitle: 'WeChat accounts, session bindings, and the people directory on one page.',
  refresh: 'Refresh',
  loading: 'Loading…',
  failed: 'Failed to load',
  retry: 'Retry',
  tabAccounts: 'Accounts',
  tabConversations: 'Conversations',
  tabPeople: 'People',
  tabIntake: 'Intake',
  accounts: 'Accounts',
  noAccounts: 'No authorized account yet.',
  provider: 'Provider',
  statusOnline: 'online',
  statusOffline: 'offline',
  bindWechat: 'Bind WeChat',
  bindTitle: 'Scan to authorize',
  bindScanHint: 'Open WeChat scan, point it at this code, and confirm on the phone.',
  bindPending: 'Waiting for the scan…',
  bindScanned: 'Scanned — confirm on the phone…',
  bindNeedsCode: 'A verify code is required: check the phone and enter it',
  bindBound: 'Authorized.',
  bindExpired: 'The QR code expired; start again.',
  bindFailed: 'Authorization failed.',
  bindQrMissing: 'The QR image is missing: press restart and try again.',
  codePlaceholder: 'Code shown on the phone',
  submitCode: 'Submit code',
  closeWizard: 'Close',
  unbindAccount: 'Remove account',
  confirmUnbindAccount: 'Press again to confirm (credential and conversation records go too)',
  conversations: 'Conversations',
  noConversations: 'No conversation recorded yet.',
  conversationsHint: 'The gateway privately holds one DSH session per WeChat conversation; messages queue up and are answered in order.',
  pendingSuffix: 'queued',
  statusQueued: 'queued',
  statusConsuming: 'processing',
  statusReplied: 'replied',
  statusFailed: 'retrying',
  statusDead: 'given up',
  people: 'People directory',
  noPeople: 'No person recorded yet.',
  peopleHint: 'Strangers who message in are recorded automatically; names and contacts fill in through the intake chat or by hand.',
  unverifiedClaim: 'claims',
  unnamedPerson: 'WeChat user',
  rename: 'Rename',
  renamePlaceholder: 'A name you will recognize',
  save: 'Save',
  cancel: 'Cancel',
  intake: 'Stranger intake',
  intakeOn: 'On: a first-time stranger receives one question',
  intakeOff: 'Off: no question, no intake record',
  intakeCounts: 'Asking',
  intakeRecent: 'Recent records',
  noIntakeRows: 'No intake records yet.',
  askedAt: 'asked at',
  intakePerson: 'Person',
  errorPrefix: 'Error',
}
