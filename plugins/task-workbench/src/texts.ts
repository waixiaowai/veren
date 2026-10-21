/**
 * 双语文案（§4.7.8 第 6 条）：进度徽标、展开/折叠、级联取消提示。
 * Bilingual strings (§4.7.8 item 6): progress badge, expand/collapse, cascade notice.
 *
 * 页面树是服务端渲染的静态节点，取词用包级默认语言；两份字典都导出，
 * 客户端后续接 locale 服务时直接复用。
 * Page trees are server-rendered static nodes; strings resolve through the
 * package default language. Both dictionaries are exported so a future client
 * can reuse them via the locale service.
 * @module @veren/task-workbench
 */

/** 支持的语言 / supported languages */
export type Lang = 'zh' | 'en'

/** 新增文案的两份字典 / both dictionaries for the new strings */
export const STRINGS = {
  progress: {
    zh: (label: string) => `子树进度 ${label}`,
    en: (label: string) => `Subtree progress ${label}`,
  },
  active: { zh: '进行中', en: 'in progress' },
  expandHint: {
    zh: '活跃分支已默认展开；终态分支折叠为进度徽标',
    en: 'Active branches are expanded by default; terminal branches collapse into a progress badge',
  },
  collapse: { zh: '折叠', en: 'Collapse' },
  expand: { zh: '展开', en: 'Expand' },
  cascadeCancelled: {
    zh: (count: number) => `父任务已取消，${count} 个子任务一并取消`,
    en: (count: number) => `The parent task was cancelled; ${count} subtask(s) cancelled with it`,
  },
  splitHint: {
    zh: '用 split_task 把 open 节点拆成子任务；仅当前接取者可用',
    en: 'Use split_task to break an open node into subtasks; the current claimant only',
  },
} as const

/** 当前包默认语言（页面树取词）/ the package default language for page trees */
export const DEFAULT_LANG: Lang = 'zh'

/**
 * 取词函数（一个文案一个具名函数，零泛型魔法，调用点类型直接可见）。
 * One named resolver per string — no generic indirection, call-site types stay
 * obvious. Both dictionaries above remain exported for a future locale client.
 */
export const tProgress = (label: string, lang: Lang = DEFAULT_LANG) => STRINGS.progress[lang](label)
export const tExpandHint = (lang: Lang = DEFAULT_LANG) => STRINGS.expandHint[lang]
