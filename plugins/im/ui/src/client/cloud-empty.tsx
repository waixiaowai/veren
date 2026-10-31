/**
 * The cloud tab's designed empty/loading block: a titled block with an optional
 * hint — never a bare line of gray text.
 *
 * 云端页签专门设计的空态/加载块：有标题、可选提示——绝不再是一行灰字。
 *
 * @module @veren/im-ui/client/cloud-empty
 */

/** The designed empty/loading block, same shape as the intake tab's. */
/** 专门设计的空态/加载块，形状与采集页签的一致。 */
export function EmptyBlock(props: { readonly title: string; readonly hint?: string }): React.JSX.Element {
  return (
    <div className="im-empty">
      <p className="im-empty-title">{props.title}</p>
      {props.hint !== undefined && <p className="im-muted">{props.hint}</p>}
    </div>
  )
}
