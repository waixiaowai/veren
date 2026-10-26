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
  | 'tabAccounts' | 'tabBindings' | 'tabPeople' | 'tabIntake'
  | 'accounts' | 'noAccounts' | 'provider' | 'statusOnline' | 'statusOffline' | 'bindWechat'
  | 'bindTitle' | 'bindScanHint' | 'bindPending' | 'bindScanned' | 'bindNeedsCode' | 'bindBound'
  | 'bindExpired' | 'bindFailed' | 'bindQrMissing' | 'codePlaceholder' | 'submitCode' | 'closeWizard'
  | 'bindings' | 'noBindings' | 'bindingsHint' | 'conversation' | 'session' | 'active' | 'inactive'
  | 'unbindBinding' | 'unbindAccount' | 'confirmUnbindAccount' | 'unlinked' | 'noUnlinked'
  | 'unlinkedHint' | 'connect' | 'people' | 'noPeople' | 'peopleHint' | 'unverifiedClaim'
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
  tabBindings: '绑定',
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
  bindings: '会话绑定',
  noBindings: '还没有会话绑定。',
  bindingsHint: '一条绑定把一个微信会话接进一个 DSH 会话；同会话的旧绑定自动让位。',
  conversation: '微信会话',
  session: 'DSH 会话',
  active: '接收中',
  inactive: '已停用',
  unbindBinding: '解绑',
  unbindAccount: '移除账号',
  confirmUnbindAccount: '再点一次确认移除（连同凭据与全部绑定）',
  unlinked: '未接入的会话',
  noUnlinked: '所有见过的会话都已接入。',
  unlinkedHint: '接入后会自动新建一个 DSH 会话，微信消息随之进来。',
  connect: '接入',
  people: '人员目录',
  noPeople: '还没有人员记录。',
  peopleHint: '发来消息的陌生人会自动收录；名字与联系方式可由采集对话或手动补全。',
  unverifiedClaim: '自称',
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
  tabBindings: 'Bindings',
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
  bindings: 'Conversation bindings',
  noBindings: 'No conversation binding yet.',
  bindingsHint: 'One binding wires one WeChat conversation into one DSH Session; older bindings on the same conversation step aside automatically.',
  conversation: 'WeChat conversation',
  session: 'DSH Session',
  active: 'receiving',
  inactive: 'inactive',
  unbindBinding: 'Unbind',
  unbindAccount: 'Remove account',
  confirmUnbindAccount: 'Press again to confirm (credential and all bindings go too)',
  unlinked: 'Unlinked conversations',
  noUnlinked: 'Every conversation seen so far is linked.',
  unlinkedHint: 'Linking creates a DSH Session automatically; WeChat messages then flow in.',
  connect: 'Link',
  people: 'People directory',
  noPeople: 'No person recorded yet.',
  peopleHint: 'Strangers who message in are recorded automatically; names and contacts fill in through the intake chat or by hand.',
  unverifiedClaim: 'claims',
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
