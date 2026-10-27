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
  | 'tabAccounts' | 'tabConversations' | 'tabPeople' | 'tabIntake' | 'tabCloud'
  | 'cloudSubtitle' | 'cloudOrigin' | 'cloudEmail' | 'cloudPassword'
  | 'cloudLogin' | 'cloudLoggingIn' | 'cloudLogout' | 'cloudSessionExpired'
  | 'cloudCredentialNote' | 'cloudOnline'
  | 'cloudSignInHeading' | 'cloudRefresh' | 'cloudChecking'
  | 'cloudUnauthorizedTitle' | 'cloudUnauthorizedHint' | 'cloudOpenAdmin'
  | 'cloudAuthStart' | 'cloudAuthStarting' | 'cloudAuthScan' | 'cloudAuthVerifyHint'
  | 'cloudAuthCodePlaceholder' | 'cloudAuthVerifySubmit' | 'cloudAuthExpired'
  | 'cloudAuthConfirmed' | 'cloudAuthManageDenied'
  | 'cloudEmptyTitle' | 'cloudEmptyHint' | 'cloudGapTitle' | 'cloudGapLine' | 'cloudGapHint'
  | 'cloudStatMessages' | 'cloudStatPeople'
  | 'cloudNotePlaceholder' | 'cloudSelfReported'
  | 'cloudRenameNote' | 'cloudSave' | 'cloudCancel' | 'cloudNote'
  | 'accounts' | 'noAccounts' | 'provider' | 'statusOnline' | 'statusOffline' | 'bindWechat'
  | 'bindTitle' | 'bindScanHint' | 'bindPending' | 'bindScanned' | 'bindNeedsCode' | 'bindBound'
  | 'bindExpired' | 'bindFailed' | 'bindQrMissing' | 'codePlaceholder' | 'submitCode' | 'closeWizard'
  | 'unbindAccount' | 'confirmUnbindAccount'
  | 'conversations' | 'noConversations' | 'conversationsHint' | 'pendingSuffix'
  | 'statusQueued' | 'statusConsuming' | 'statusReplied' | 'statusFailed' | 'statusDead'
  | 'people' | 'noPeople' | 'peopleHint' | 'unverifiedClaim'
  | 'unnamedPerson' | 'rename' | 'renamePlaceholder' | 'save' | 'cancel'
  | 'intake' | 'intakeOn' | 'intakeOff' | 'intakeRecent'
  | 'intakePipe' | 'statusAsked' | 'statusAnswered' | 'statusDeclined' | 'statusExpired'
  | 'intakeWaiting' | 'intakeWaitingHint' | 'intakeDeadline' | 'intakeSettledAt'
  | 'intakeAskPreview' | 'boundsReplyWindow' | 'boundsMaxAsks' | 'boundsMinGap'
  | 'unitMinutes' | 'unitSeconds' | 'intakeOutcomeName' | 'intakeOutcomeContact' | 'intakeOutcomeBoth'
  | 'intakeEmptyTitle' | 'intakeEmptyHint' | 'intakeAuditEmpty' | 'intakeStale'
  | 'intakeNoData' | 'intakeNoDataHint'
  | 'askedAt' | 'errorPrefix'

/** Chinese dictionary. */
export const zh: Record<ImKey, string> = {
  cloudAuthStart: "发起授权",
  cloudAuthStarting: "发起中…",
  cloudAuthScan: "用微信扫下面的码，并在手机上点确认（约 2 分钟有效）：",
  cloudAuthVerifyHint: "手机上显示了验证码，输入后提交：",
  cloudAuthCodePlaceholder: "验证码",
  cloudAuthVerifySubmit: "提交验证码",
  cloudAuthExpired: "二维码已过期，请重新发起。",
  cloudAuthConfirmed: "授权成功，通道已接管。",
  cloudAuthManageDenied: "当前账号没有 imhub:manage 权限——请用 admin 账号，或给该角色勾选「IM Hub 管理面」。",
  tabCloud: "云端",
  cloudSubtitle: "登录 CMS 后查看该账号的全部 IM 信息（消息日志与人员目录归云）。",
  cloudOrigin: "CMS 地址",
  cloudEmail: "邮箱",
  cloudPassword: "密码",
  cloudLogin: "登录",
  cloudLoggingIn: "登录中…",
  cloudLogout: "登出",
  cloudSessionExpired: "登录已过期，请重新登录。",
  cloudCredentialNote: "登录凭据只保存在本页签（sessionStorage），不会写入宿主配置。",
  cloudOnline: "通道在线",
  cloudSignInHeading: "登录 CMS",
  cloudRefresh: "刷新云端",
  cloudChecking: "正在连接 CMS…",
  cloudUnauthorizedTitle: "通道未授权",
  cloudUnauthorizedHint: "到 CMS 管理面扫码授权后，消息与人员目录才开始同步到这里。",
  cloudOpenAdmin: "打开 CMS 管理面",
  cloudEmptyTitle: "云端目录为空",
  cloudEmptyHint: "设备观察到发送者后会上报至此。",
  cloudGapTitle: "该 CMS 实例还没有 IM 用户面",
  cloudGapLine: "登录成功，但 imhub 模块未部署。",
  cloudGapHint: "部署 2.3.0 后此页即可用；或登出后把 CMS 地址改回本地实例。",
  cloudStatMessages: "消息",
  cloudStatPeople: "人员",
  cloudNotePlaceholder: "备注",
  cloudSelfReported: "自称：",
  cloudRenameNote: "改名/备注",
  cloudSave: "保存",
  cloudCancel: "取消",
  cloudNote: "备注：",
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
  intakeRecent: '最近记录',
  intakePipe: '采集管道',
  statusAsked: '询问中',
  statusAnswered: '已回答',
  statusDeclined: '已婉拒',
  statusExpired: '已过期',
  intakeWaiting: '等待答复',
  intakeWaitingHint: '这些陌生人已收到询问；对方的回复会自动收尾，无需操作。',
  intakeDeadline: '截止',
  intakeSettledAt: '收尾于',
  intakeAskPreview: '陌生人会收到：',
  boundsReplyWindow: '回复窗口',
  boundsMaxAsks: '每小时上限',
  boundsMinGap: '两次间隔',
  unitMinutes: '分钟',
  unitSeconds: '秒',
  intakeOutcomeName: '拿到称呼',
  intakeOutcomeContact: '拿到联系方式',
  intakeOutcomeBoth: '称呼+联系方式',
  intakeEmptyTitle: '还没有采集记录',
  intakeEmptyHint: '开启采集后，陌生人第一次发消息会收到一条询问；对方的回答会自动收尾成一条记录。',
  intakeAuditEmpty: '审计窗口内没有记录。',
  intakeStale: '以下为最后一次成功读取的数据。',
  intakeNoData: '还没有读到过采集数据。',
  intakeNoDataHint: '宿主通道出错（见页首错误行）。点「刷新」重试。',
  askedAt: '询问于',
  errorPrefix: '出错',
}

/** English dictionary. */
export const en: Record<ImKey, string> = {
  cloudAuthStart: "Start authorization",
  cloudAuthStarting: "Starting…",
  cloudAuthScan: "Scan with WeChat and confirm on the phone (~2 min validity):",
  cloudAuthVerifyHint: "The phone shows a verify code — enter it here:",
  cloudAuthCodePlaceholder: "verify code",
  cloudAuthVerifySubmit: "Submit code",
  cloudAuthExpired: "The QR expired — start again.",
  cloudAuthConfirmed: "Authorized — the channel is now owned by the cloud.",
  cloudAuthManageDenied: "This account lacks imhub:manage — sign in as admin or grant the role the IM Hub manage permission.",
  tabCloud: "Cloud",
  cloudSubtitle: "Sign in to CMS to see all IM data of this account (message log and people live on the cloud).",
  cloudOrigin: "CMS origin",
  cloudEmail: "Email",
  cloudPassword: "Password",
  cloudLogin: "Sign in",
  cloudLoggingIn: "Signing in…",
  cloudLogout: "Sign out",
  cloudSessionExpired: "Session expired, please sign in again.",
  cloudCredentialNote: "Credentials stay in this tab (sessionStorage) and never enter the host config.",
  cloudOnline: "Channel online",
  cloudSignInHeading: "Sign in to CMS",
  cloudRefresh: "Refresh cloud",
  cloudChecking: "Connecting to CMS…",
  cloudUnauthorizedTitle: "Channel not authorized",
  cloudUnauthorizedHint: "Scan the QR on the CMS admin face to authorize; messages and the people directory start syncing here.",
  cloudOpenAdmin: "Open the CMS admin face",
  cloudEmptyTitle: "The cloud directory is empty",
  cloudEmptyHint: "Devices push senders here as they observe them.",
  cloudGapTitle: "This CMS instance has no IM user plane",
  cloudGapLine: "Signed in, but the imhub module is not deployed.",
  cloudGapHint: "Available after 2.3.0 is deployed; or sign out and point the CMS origin back at the local instance.",
  cloudStatMessages: "messages",
  cloudStatPeople: "people",
  cloudNotePlaceholder: "note",
  cloudSelfReported: "self-reported: ",
  cloudRenameNote: "rename/note",
  cloudSave: "Save",
  cloudCancel: "Cancel",
  cloudNote: "note: ",
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
  intakeRecent: 'Recent records',
  intakePipe: 'Pipeline',
  statusAsked: 'Waiting',
  statusAnswered: 'Answered',
  statusDeclined: 'Declined',
  statusExpired: 'Expired',
  intakeWaiting: 'Awaiting replies',
  intakeWaitingHint: 'These strangers received the question; their replies settle the records automatically — nothing to do.',
  intakeDeadline: 'deadline',
  intakeSettledAt: 'settled at',
  intakeAskPreview: 'Strangers receive: ',
  boundsReplyWindow: 'Reply window',
  boundsMaxAsks: 'Hourly cap',
  boundsMinGap: 'Ask gap',
  unitMinutes: 'min',
  unitSeconds: 's',
  intakeOutcomeName: 'name',
  intakeOutcomeContact: 'contact',
  intakeOutcomeBoth: 'name + contact',
  intakeEmptyTitle: 'No intake records yet',
  intakeEmptyHint: 'With intake on, a first-time stranger receives one question; their answer settles into a record here automatically.',
  intakeAuditEmpty: 'No rows in the audit window.',
  intakeStale: 'Showing the last successful read.',
  intakeNoData: 'No intake data has been read yet.',
  intakeNoDataHint: 'The host channel errored (see the error line at the top); press Refresh to retry.',
  askedAt: 'asked at',
  errorPrefix: 'Error',
}
