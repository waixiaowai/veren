/**
 * The wide-screen rails: the boards rail on the left (the pill bar's vertical
 * counterpart, plus the all-boards entry) and the community rail on the right
 * (stats, top tags, members). Both are stateless leaves — selection and writes
 * stay one level up, reported through callbacks. CSS shows them only inside a
 * wide page container, so narrow containers render exactly the old shell.
 *
 * 宽屏两侧栏：左侧板块栏（胶囊栏的竖排对应物，外加「全部板块」入口）与右侧社区栏
 * （统计、热门标签、成员）。两者都是无状态叶组件——选中与写入仍留在上一层，经回调上报。
 * CSS 只在宽容器里显示它们，窄容器渲染的仍是原来的外壳。
 *
 * @module @veren/forum-ui/client/panel-rail
 */

import type { CatalogView, PostView } from './remote.ts'
import type { ForumKey } from './locales.ts'
import { initial } from './panel-model.ts'

/** The tag vocabulary ranked by use, most used first, capped for the rail. 按用量排序的标签词汇表，最多取前几个。 */
const TOP_TAG_LIMIT = 8

/** Rank the posts' tags by frequency, most used first, capped at eight. 按出现次数给帖子标签排序，取前八。 */
function topTagsOf(posts: readonly PostView[]): readonly string[] {
  const counts = new Map<string, number>()
  for (const post of posts) for (const tag of post.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, TOP_TAG_LIMIT)
    .map(([tag]) => tag)
}

/** One rail entry's shared look: the row button plus its count badge. 一条栏目的共用外观：行按钮与计数徽标。 */
function RailItem(props: {
  readonly title: string
  readonly count: number
  readonly selected: boolean
  readonly onSelect: () => void
}) {
  const { title, count, selected, onSelect } = props
  return (
    <button
      type="button" className="forum-rail-item"
      aria-selected={selected} onClick={onSelect}
    >
      <span className="forum-rail-item-title">{title}</span>
      <span className="forum-rail-count">{count}</span>
    </button>
  )
}

/**
 * The left boards rail: one row per board — the pill bar's vertical
 * counterpart for wide containers. The board set and the selection semantics
 * are exactly the pill bar's: one board at a time, the host picks the default.
 * 左侧板块栏：每个板块一行——胶囊栏在宽容器下的竖排对应物。板块集合与选中语义和
 * 胶囊栏完全一致：一次一个板块，默认板块由宿主决定。
 */
export function BoardRail(props: {
  readonly t: (key: ForumKey) => string
  readonly boards: readonly { readonly id: string; readonly title: string; readonly postCount: number }[]
  readonly shownBoard: string | undefined
  readonly onSelect: (id: string) => void
}) {
  const { t, boards, shownBoard, onSelect } = props
  return (
    <nav className="forum-rail forum-rail-boards" aria-label={t('boards')}>
      <span className="forum-rail-label">{t('boards')}</span>
      {boards.map(board => (
        <RailItem
          key={board.id} title={board.title} count={board.postCount}
          selected={board.id === shownBoard} onSelect={() => { onSelect(board.id) }}
        />
      ))}
    </nav>
  )
}

/** One stats tile: the number on top, its label below. 一个统计格：数字在上，标签在下。 */
function StatTile(props: { readonly value: number; readonly label: string }) {
  const { value, label } = props
  return (
    <div className="forum-stat-tile">
      <span className="forum-stat-value">{value}</span>
      <span className="forum-stat-label">{label}</span>
    </div>
  )
}

/** One member row: avatar, name, and the auto-post badge when it applies. 一行成员：头像、名字，以及（若开启）自动发帖徽标。 */
function PersonRow(props: {
  readonly t: (key: ForumKey) => string
  readonly name: string
  readonly autoPost: boolean
  readonly onPostAs: (name: string) => void
}) {
  const { t, name, autoPost, onPostAs } = props
  return (
    <button type="button" className="forum-person" title={t('postAs')} onClick={() => { onPostAs(name) }}>
      <span className="forum-avatar" aria-hidden="true">{initial(name)}</span>
      <span className="forum-person-name">{name}</span>
      {autoPost && <span className="forum-person-badge">{t('autoPost')}</span>}
    </button>
  )
}

/** The board's tag cloud: one chip per tag, the active one marked; an empty board says so instead. 板块标签云：每个标签一枚胶囊，标出当前选中的；空板块则给出说明文案。 */
function TagCloud(props: {
  readonly t: (key: ForumKey) => string
  readonly tags: readonly string[]
  readonly activeTag: string
  readonly onTag: (value: string) => void
}) {
  const { t, tags, activeTag, onTag } = props
  if (tags.length === 0) return <p className="forum-side-hint">{t('noTags')}</p>
  return (
    <div className="forum-tag-cloud">
      {tags.map(tag => (
        <button
          key={tag} type="button"
          className={tag === activeTag ? 'forum-tag-chip is-active' : 'forum-tag-chip'}
          onClick={() => { onTag(tag === activeTag ? '' : tag) }}
        >{tag}</button>
      ))}
    </div>
  )
}

/** The three global counts: boards, the topics they hold, and the people. 三项全局计数：板块数、板块内主题总数与成员数。 */
function CommunityStats(props: { readonly t: (key: ForumKey) => string; readonly view: CatalogView }) {
  const { t, view } = props
  const topics = view.boards.reduce((sum, board) => sum + board.postCount, 0)
  return (
    <div className="forum-stats">
      <StatTile value={view.boards.length} label={t('boards')} />
      <StatTile value={topics} label={t('statTopics')} />
      <StatTile value={view.people.length} label={t('members')} />
    </div>
  )
}

/**
 * The right community rail: three global stats, the board's top tags
 * (click to filter, click again to clear), and the members (click to compose
 * as that member).
 * 右侧社区栏：三项全局统计、板块热门标签（点一下筛选，再点一下清除），以及成员
 * （点一下以该成员身份打开发帖框）。
 */
export function CommunityRail(props: {
  readonly t: (key: ForumKey) => string
  readonly view: CatalogView
  readonly activeTag: string
  readonly onTag: (value: string) => void
  readonly onPostAs: (name: string) => void
}) {
  const { t, view, activeTag, onTag, onPostAs } = props
  const tags = topTagsOf(view.posts)
  return (
    <aside className="forum-rail forum-rail-side">
      <section className="forum-side-card">
        <h3 className="forum-side-title">{t('community')}</h3>
        <CommunityStats t={t} view={view} />
      </section>
      <section className="forum-side-card">
        <h3 className="forum-side-title">{t('topTags')}</h3>
        <TagCloud t={t} tags={tags} activeTag={activeTag} onTag={onTag} />
      </section>
      <section className="forum-side-card">
        <h3 className="forum-side-title">{t('members')}</h3>
        <div className="forum-people">
          {view.people.map(person => (
            <PersonRow key={person.name} t={t} name={person.name} autoPost={person.autoPost} onPostAs={onPostAs} />
          ))}
        </div>
      </section>
    </aside>
  )
}
