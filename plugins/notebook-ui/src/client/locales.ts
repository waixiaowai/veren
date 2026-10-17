/**
 * The notebook page's typed copy, in both locales.
 *
 * Every product-visible string the page renders lives here and reaches the
 * components through the framework's `t` seat, so a missing translation is a
 * compile error rather than an English word in a Chinese page.
 *
 * 记事本页面的双语类型化文案。
 *
 * 页面渲染的每一条产品可见文案都住在这里，并通过框架的 `t` 座位到达组件，因此漏译是编译
 * 错误，而不是中文页面里冒出一个英文词。
 *
 * @module @veren/notebook-ui/client/locales
 */

/** Dictionary namespace owned by this plugin. */
export const NS = 'notebook'

/** Every key the notebook page can render. */
export type NotebookKey =
  | 'panel' | 'panelSubtitle' | 'owner' | 'ownerHint' | 'notes' | 'noOwners' | 'noNotes' | 'noNotesHint'
  | 'newNote' | 'newNoteHint' | 'editNote' | 'title' | 'titlePlaceholder' | 'body' | 'bodyPlaceholder'
  | 'save' | 'saving' | 'delete' | 'confirmDelete' | 'refresh' | 'loading' | 'failed' | 'retry'
  | 'emptyTitle' | 'emptyBody' | 'saved' | 'deleted' | 'unsaved' | 'titleRequired' | 'bodyTooLong'
  | 'removed' | 'updatedAt' | 'selectNote' | 'close'

/** Chinese dictionary. */
export const zh: Record<NotebookKey, string> = {
  panel: '记事本',
  panelSubtitle: '每个预设一本私密笔记，跟着预设走，不跟着工作区走。',
  owner: '记事本属于',
  ownerHint: '选择要看谁的记事本。别的预设看不到这一本。',
  notes: '笔记',
  noOwners: '还没有可选的预设。',
  noNotes: '这本记事本还是空的。',
  noNotesHint: '写下第一条，之后用工具或这个页面都能翻到。',
  newNote: '新建笔记',
  newNoteHint: '标题必填，正文可以为空。',
  editNote: '编辑笔记',
  title: '标题',
  titlePlaceholder: '一句话说清这条笔记记什么',
  body: '正文',
  bodyPlaceholder: '写值得留下、以后还能翻到的内容',
  save: '保存',
  saving: '保存中…',
  delete: '删除',
  confirmDelete: '再点一次确认删除',
  refresh: '刷新',
  loading: '正在读取…',
  failed: '读取失败',
  retry: '重试',
  emptyTitle: '还没有选中笔记',
  emptyBody: '从左边选一条，或者新建一条。',
  saved: '已保存',
  deleted: '已删除',
  unsaved: '有未保存的修改',
  titleRequired: '标题不能为空。',
  bodyTooLong: '正文超过长度上限。',
  removed: '预设已删除，笔记仍保留',
  updatedAt: '更新于',
  selectNote: '选择一条笔记',
  close: '关闭',
}

/** English dictionary. */
export const en: Record<NotebookKey, string> = {
  panel: 'Notebook',
  panelSubtitle: 'One private notebook per preset, carried by the preset, not by the workspace.',
  owner: 'Notebook owner',
  ownerHint: 'Choose whose notebook to read. No other preset can see it.',
  notes: 'Notes',
  noOwners: 'No preset is available yet.',
  noNotes: 'This notebook is empty.',
  noNotesHint: 'Write the first note; the tools and this page will both find it later.',
  newNote: 'New note',
  newNoteHint: 'A title is required; the body may be empty.',
  editNote: 'Edit note',
  title: 'Title',
  titlePlaceholder: 'One line saying what this note is about',
  body: 'Body',
  bodyPlaceholder: 'Write what is worth keeping and finding again',
  save: 'Save',
  saving: 'Saving…',
  delete: 'Delete',
  confirmDelete: 'Click again to delete',
  refresh: 'Refresh',
  loading: 'Loading…',
  failed: 'Could not read',
  retry: 'Retry',
  emptyTitle: 'No note selected',
  emptyBody: 'Pick one on the left, or create a new one.',
  saved: 'Saved',
  deleted: 'Deleted',
  unsaved: 'Unsaved changes',
  titleRequired: 'A title is required.',
  bodyTooLong: 'The body is over its length limit.',
  removed: 'Preset removed; notes retained',
  updatedAt: 'Updated',
  selectNote: 'Select a note',
  close: 'Close',
}
