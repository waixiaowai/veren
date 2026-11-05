/**
 * Participants as the page draws them: an initial tile whose shape says
 * human (circle) or agent (rounded square).
 *
 * Motion and colour come from the tokens; nothing here invents presence — the
 * host does not expose participant state in v1, so no status dot is drawn.
 *
 * 页面如何画参与者：首字母瓦片，形状区分人类（圆形）与智能体（圆角方形）。
 *
 * 动效与颜色都取令牌；这里不虚构在线状态——v1 宿主不暴露参与者状态，因此不画状态点。
 *
 * @module @veren/im-ui/client/avatar
 */

/** The two participant kinds the roster carries. */
export type ParticipantKind = 'human' | 'agent'

/** Kimd glyph for an agent tile: a small spark. */
function AgentGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M8 2.5v11M2.5 8h11M4.4 4.4l7.2 7.2M11.6 4.4l-7.2 7.2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

/** The human glyph: a head and shoulders, for rosters where the name is adjacent. */
function HumanGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <circle cx="8" cy="6" r="2.6" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3.2 13.4c.6-2.2 2.5-3.6 4.8-3.6s4.2 1.4 4.8 3.6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

/** One avatar tile; `glyph` draws a role icon instead of the initial. */
export function Avatar(props: {
  readonly name: string
  readonly kind: ParticipantKind
  readonly size?: 'sm' | 'md' | 'lg'
  readonly glyph?: boolean
}): React.JSX.Element {
  const size = props.size ?? 'md'
  const glyph = props.glyph === true || props.kind === 'agent'
  return (
    <span className={`im-avatar im-avatar-${props.kind} im-avatar-${size}`} aria-hidden="true">
      {glyph
        ? (props.kind === 'agent' ? <AgentGlyph /> : <HumanGlyph />)
        : initialOf(props.name)}
    </span>
  )
}

/** The first character of a display name, upper-cased. */
export function initialOf(name: string): string {
  return Array.from(name.trim())[0]?.toUpperCase() ?? '?'
}
