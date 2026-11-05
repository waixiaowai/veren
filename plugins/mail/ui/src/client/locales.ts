/**
 * The page's dictionaries: the copy in both baseline locales.
 *
 * The key union is declared once and both dictionaries are typed against it,
 * so a key that exists in one language and not the other is a compile error
 * rather than a missing string at runtime.
 *
 * 页面的词典：两种基线语言的文案。
 *
 * 键联合只声明一次，两份词典都按它定型，因此「一种语言有、另一种没有」的键是编译错误，
 * 而不是运行时的缺失字符串。
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
  | 'activityEmpty'
  | 'unread'
  | 'read'
  | 'archived'
  | 'markRead'
  | 'markUnread'
  | 'archive'
  | 'unarchive'
  | 'step'
  | 'recipient'
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
  activityEmpty: '还没有触发过任何通知',
  unread: '未读',
  read: '已读',
  archived: '已归档',
  markRead: '标记为已读',
  markUnread: '标记为未读',
  archive: '归档',
  unarchive: '取消归档',
  step: '步骤',
  recipient: '收件人',
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
  activityEmpty: 'No notification has been triggered yet',
  unread: 'Unread',
  read: 'Read',
  archived: 'Archived',
  markRead: 'Mark as read',
  markUnread: 'Mark as unread',
  archive: 'Archive',
  unarchive: 'Unarchive',
  step: 'Step',
  recipient: 'Recipient',
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
}
