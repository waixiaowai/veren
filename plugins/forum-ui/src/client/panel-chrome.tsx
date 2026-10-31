/**
 * The forum page's chrome: the header (title, acting-as picker, and the two
 * header actions) and the board pill bar. Both are stateless leaf segments the
 * body composes; the render output is byte-for-byte the markup the single-file
 * panel used to inline.
 *
 * 论坛页面的页面级镶边：页头（标题、身份选择器与两个页头动作）与板块标签栏。
 * 两者都是页面体组合的无状态叶段；渲染输出与单文件面板此前的内联标记逐字一致。
 *
 * @module @veren/forum-ui/client/panel-chrome
 */

import type { BoardView, PersonView } from './remote.ts'
import type { ForumKey } from './locales.ts'
import { ChatIcon, GearIcon, PlusIcon } from './panel-kit.tsx'

/** The header's right side: the acting-as picker and the config/new-post actions. 页头右侧：身份选择器与配置/发帖两个动作。 */
function HeaderActions(props: {
  readonly t: (key: ForumKey) => string
  readonly people: readonly PersonView[]
  readonly active: string | undefined
  readonly configOpen: boolean
  readonly onActor: (value: string) => void
  readonly onToggleConfig: () => void
  readonly onOpenComposer: () => void
}) {
  const { t, people, active, configOpen, onActor, onToggleConfig, onOpenComposer } = props
  return (
    <div className="forum-header-actions">
      {people.length > 0 && (
        <label className="forum-actor">
          <span>{t('actingAs')}</span>
          <select
            value={active ?? ''} aria-label={t('actingAs')}
            onChange={event => { onActor(event.target.value) }}
          >
            {people.map(person => <option key={person.name} value={person.name}>{person.name}</option>)}
          </select>
        </label>
      )}
      <button
        type="button"
        className={configOpen ? 'forum-btn forum-primary forum-cta' : 'forum-btn forum-cta'}
        aria-pressed={configOpen}
        onClick={onToggleConfig}
      >
        <GearIcon />
        {t('config')}
      </button>
      <button type="button" className="forum-btn forum-primary forum-cta" onClick={onOpenComposer}>
        <PlusIcon />
        {t('newPost')}
      </button>
    </div>
  )
}

/** The page header: title, acting-as picker, and the config/new-post actions. 页头：标题、身份选择器与配置/发帖两个动作。 */
export function PageHeader(props: {
  readonly t: (key: ForumKey) => string
  readonly people: readonly PersonView[]
  readonly active: string | undefined
  readonly configOpen: boolean
  readonly onActor: (value: string) => void
  readonly onToggleConfig: () => void
  readonly onOpenComposer: () => void
}) {
  const { t, people, active, configOpen, onActor, onToggleConfig, onOpenComposer } = props
  return (
    <header className="forum-header">
      <div className="forum-heading">
        <div className="forum-heading-row">
          <span className="forum-mark" aria-hidden="true"><ChatIcon /></span>
          <h1>{t('panel')}</h1>
        </div>
        <p>{t('panelSubtitle')}</p>
      </div>
      <HeaderActions
        t={t} people={people} active={active} configOpen={configOpen}
        onActor={onActor} onToggleConfig={onToggleConfig} onOpenComposer={onOpenComposer}
      />
    </header>
  )
}

/** The board pill bar: one pill per board, empty hint when no board exists. 板块标签栏：一个板块一枚标签，无板块时显示空态提示。 */
export function BoardBar(props: {
  readonly t: (key: ForumKey) => string
  readonly boards: readonly BoardView[]
  readonly shownBoard: string | undefined
  readonly onSelect: (id: string) => void
}) {
  const { t, boards, shownBoard, onSelect } = props
  return (
    <nav className="forum-boardbar" aria-label={t('boards')}>
      {boards.length === 0
        ? <span className="forum-boardbar-empty">{t('noBoards')}</span>
        : boards.map(board => (
          <button
            key={board.id} type="button" className="forum-pill"
            aria-selected={board.id === shownBoard}
            onClick={() => { onSelect(board.id) }}
          >
            {board.title}
            <span className="forum-pill-count">{board.postCount}</span>
          </button>
        ))}
    </nav>
  )
}
