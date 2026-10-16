/**
 * One dropdown built on the shared `ui-primitives` Menu and Button.
 *
 * The shell shares `@deepseek-ai/dsh-client-ui-primitives` through its frozen
 * module table, so the panel renders the same menu surface, keyboard walk, and
 * check selection as every shipped dropdown instead of a hand-styled
 * `<select>`. The list renders through a portal because the detail pane
 * scrolls and would clip an in-place list.
 *
 * 基于共享 `ui-primitives` 的 Menu 与 Button 构建的下拉。外壳把
 * `@deepseek-ai/dsh-client-ui-primitives` 放进冻结模块表共享，面板因此与自带下拉
 * 使用同一套菜单表面、键盘漫游与选中勾号，而不是手写样式的 `<select>`。列表经
 * portal 渲染：详情面板可滚动，就地列表会被裁切。
 *
 * @module @veren/startup-autostart/client/select
 */

import { useState } from 'react'
import { Button, IconChevronDownOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'

/** One selectable option. */
export interface SelectOption {
  /** Value reported to {@link SelectMenuProps.onChange}. */
  readonly value: string
  /** User-visible row label; also the trigger's closed text. */
  readonly label: string
}

/** Props of {@link SelectMenu}. */
export interface SelectMenuProps {
  /** Accessible name of the trigger button. */
  readonly ariaLabel: string
  /** Currently held value; the matching option's label fills the trigger. */
  readonly value: string
  /** Every selectable option, in display order. */
  readonly options: readonly SelectOption[]
  /** Called with the chosen option's value. */
  readonly onChange: (value: string) => void
}

/**
 * Render one dropdown.
 * @param props - accessible name, current value, options, and the change callback.
 * @returns the outline-button trigger with its portaled check-select menu.
 */
export function SelectMenu(props: SelectMenuProps): React.ReactElement {
  const [open, setOpen] = useState(false)
  const current = props.options.find(option => option.value === props.value)
  return (
    <Menu portal dense compact autoFocus
      open={open}
      anchor={
        <Button variant="outline" size="sm" className="sa-select-trigger"
          aria-label={props.ariaLabel} aria-haspopup="menu" aria-expanded={open}
          onClick={() => { setOpen(true) }}>
          <span className="sa-select-value">{current === undefined ? props.value : current.label}</span>
          <IconChevronDownOutlineRegular />
        </Button>
      }
      items={props.options.map(option => ({ id: option.value, label: option.label }))}
      selectedId={props.value}
      onSelect={id => { setOpen(false); props.onChange(id) }}
      onClose={() => { setOpen(false) }} />
  )
}
