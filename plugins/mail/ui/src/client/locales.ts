/**
 * The page's dictionaries: the copy in both baseline locales.
 *
 * The key union is declared once and both dictionaries are typed against it,
 * so a key that exists in one language and not the other is a compile error
 * rather than a missing string at runtime. A `{n}` placeholder inside a
 * template is filled by `format.ts`'s `fillCount`.
 *
 * 页面的词典：两种基线语言的文案。
 *
 * 键联合只声明一次，两份词典都按它定型，因此「一种语言有、另一种没有」的键是编译错误，
 * 而不是运行时的缺失字符串。模板里的 `{n}` 占位符由 `format.ts` 的 `fillCount` 填充。
 *
 * @module @veren/mail-ui/client/locales
 */

/** The dictionary namespace owned by this plugin. */
export const NS = 'mail-ui'

/** Every key the page can render. */
export type MailKey =
  | 'panel'
  | 'panelSubtitle'
  | 'refresh'
  | 'loading'
  | 'errorPrefix'
  | 'tabInbox'
  | 'tabActivity'
  | 'inboxEmpty'
  | 'inboxEmptySub'
  | 'filterEmpty'
  | 'filterEmptySub'
  | 'activityEmpty'
  | 'activityEmptySub'
  | 'filterAll'
  | 'filterUnread'
  | 'filterArchived'
  | 'unread'
  | 'read'
  | 'archived'
  | 'markRead'
  | 'markUnread'
  | 'archive'
  | 'unarchive'
  | 'step'
  | 'skipReason'
  | 'delivered'
  | 'failed'
  | 'skipped'
  | 'pending'
  | 'running'
  | 'sent'
  | 'deliveredChain'
  | 'erroredChain'
  | 'skippedChain'
  | 'noRecipient'
  | 'recipients'
  | 'deliveryError'
  | 'deliveryWarning'
  | 'stepQueued'
  | 'stepCompleted'
  | 'stepDelayed'
  | 'stepCanceled'
  | 'stepMerged'
  | 'chainCanceled'
  | 'chainMerged'
  | 'chainInteracted'
  | 'skipStepCondition'
  | 'skipPreference'
  | 'skipMissingEmail'
  | 'skipMissingPhone'
  | 'skipMissingPushToken'
  | 'skipMissingWebhookUrl'
  | 'channelInApp'
  | 'channelEmail'
  | 'channelSms'
  | 'channelChat'
  | 'channelPush'
  | 'channelTool'
  | 'timeNow'
  | 'timeMinutes'
  | 'timeHours'
  | 'timeDays'
  | 'timeMonths'
  | 'timeYears'
  | 'durationSeconds'
  | 'durationMinutes'

/** The Chinese dictionary. */
export const zh: Record<MailKey, string> = {
  panel: '通知',
  panelSubtitle: '查看已送达的通知与每次触发的执行情况',
  refresh: '刷新',
  loading: '加载中…',
  errorPrefix: '出错了',
  tabInbox: '收件箱',
  tabActivity: '执行记录',
  inboxEmpty: '还没有收到任何通知',
  inboxEmptySub: '抵达站内收件箱的通知会显示在这里',
  filterEmpty: '没有符合筛选条件的通知',
  filterEmptySub: '试试切换回「全部」',
  activityEmpty: '还没有触发过任何通知',
  activityEmptySub: '每次触发的工作流执行链会显示在这里',
  filterAll: '全部',
  filterUnread: '未读',
  filterArchived: '已归档',
  unread: '未读',
  read: '已读',
  archived: '已归档',
  markRead: '标记为已读',
  markUnread: '标记为未读',
  archive: '归档',
  unarchive: '取消归档',
  step: '步骤',
  skipReason: '跳过原因',
  delivered: '已送达',
  failed: '失败',
  skipped: '已跳过',
  pending: '待处理',
  running: '进行中',
  sent: '已发送',
  deliveredChain: '已送达',
  erroredChain: '有失败',
  skippedChain: '全部跳过',
  noRecipient: '无收件人',
  recipients: '{n} 位收件人',
  deliveryError: '投递失败',
  deliveryWarning: '投递警告',
  stepQueued: '已入队',
  stepCompleted: '已完成',
  stepDelayed: '已延迟',
  stepCanceled: '已取消',
  stepMerged: '已合并',
  chainCanceled: '已取消',
  chainMerged: '已合并',
  chainInteracted: '已交互',
  skipStepCondition: '未通过步骤条件',
  skipPreference: '被收件人偏好拦下',
  skipMissingEmail: '收件人没有邮箱',
  skipMissingPhone: '收件人没有手机号',
  skipMissingPushToken: '收件人没有推送令牌',
  skipMissingWebhookUrl: '收件人没有 webhook 地址',
  channelInApp: '站内信',
  channelEmail: '邮件',
  channelSms: '短信',
  channelChat: '聊天',
  channelPush: '推送',
  channelTool: '工具',
  timeNow: '刚刚',
  timeMinutes: '{n} 分钟前',
  timeHours: '{n} 小时前',
  timeDays: '{n} 天前',
  timeMonths: '{n} 个月前',
  timeYears: '{n} 年前',
  durationSeconds: '耗时 {n} 秒',
  durationMinutes: '耗时 {n} 分钟',
}

/** The English dictionary. */
export const en: Record<MailKey, string> = {
  panel: 'Notifications',
  panelSubtitle: 'What was delivered, and what each trigger actually did',
  refresh: 'Refresh',
  loading: 'Loading…',
  errorPrefix: 'Error',
  tabInbox: 'Inbox',
  tabActivity: 'Activity',
  inboxEmpty: 'No notifications have arrived',
  inboxEmptySub: 'Notices that reached the station inbox will appear here',
  filterEmpty: 'No notification matches this filter',
  filterEmptySub: 'Try switching back to "All"',
  activityEmpty: 'No notification has been triggered yet',
  activityEmptySub: 'Every trigger\'s execution chain will appear here',
  filterAll: 'All',
  filterUnread: 'Unread',
  filterArchived: 'Archived',
  unread: 'Unread',
  read: 'Read',
  archived: 'Archived',
  markRead: 'Mark as read',
  markUnread: 'Mark as unread',
  archive: 'Archive',
  unarchive: 'Unarchive',
  step: 'Step',
  skipReason: 'Skipped because',
  delivered: 'Delivered',
  failed: 'Failed',
  skipped: 'Skipped',
  pending: 'Pending',
  running: 'Running',
  sent: 'Sent',
  deliveredChain: 'Delivered',
  erroredChain: 'Had failures',
  skippedChain: 'All skipped',
  noRecipient: 'No recipient',
  recipients: '{n} recipients',
  deliveryError: 'Delivery failed',
  deliveryWarning: 'Delivery warning',
  stepQueued: 'Queued',
  stepCompleted: 'Completed',
  stepDelayed: 'Delayed',
  stepCanceled: 'Canceled',
  stepMerged: 'Merged',
  chainCanceled: 'Canceled',
  chainMerged: 'Merged',
  chainInteracted: 'Interacted',
  skipStepCondition: 'Failed the step condition',
  skipPreference: 'Stopped by the recipient\'s preferences',
  skipMissingEmail: 'The recipient has no email address',
  skipMissingPhone: 'The recipient has no phone number',
  skipMissingPushToken: 'The recipient has no push token',
  skipMissingWebhookUrl: 'The recipient has no webhook URL',
  channelInApp: 'In-app',
  channelEmail: 'Email',
  channelSms: 'SMS',
  channelChat: 'Chat',
  channelPush: 'Push',
  channelTool: 'Tool',
  timeNow: 'just now',
  timeMinutes: '{n} min ago',
  timeHours: '{n} h ago',
  timeDays: '{n} d ago',
  timeMonths: '{n} mo ago',
  timeYears: '{n} y ago',
  durationSeconds: 'took {n}s',
  durationMinutes: 'took {n}m',
}
