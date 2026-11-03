/** A field holding a plain list of strings: one input per entry, submitted as `string[]` (a `rows` field submits records). */
/** 一个纯字符串列表字段：每项一个输入框，提交 `string[]`（`rows` 字段提交的是记录）。 */
import { useState } from 'react'
import type { FieldSpec } from '../sources/kind.ts'
import { Button, Icon, InfoTip, Input } from './controls.tsx'
import { usePanel } from './provider.tsx'
import { localized } from './text.ts'

/** Entries shown before the list folds into one line of its values. */
const LIST_SHOWN = 6
export function ListField({ field, value, onChange }: {
  field: Extract<FieldSpec, { type: 'list' }>; value: unknown; onChange: (next: string[]) => void
}) {
  const { t } = usePanel()
  const [open, setOpen] = useState(false)
  const label = localized(t, field.label), hint = localized(t, field.hint), placeholder = localized(t, field.placeholder) || label
  // A stored list is the only source of truth; anything else (a first render before the block loads) reads as empty.
  const items = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  const set = (index: number, next: string) => onChange(items.map((item, position) => position === index ? next : item))
  return <div className="dt-field">
    <div className="dt-subhead">
      <span className="dt-field-head">{label}{hint && <InfoTip text={hint} />}<span className="dt-count">{items.length || ''}</span></span>
      <span className="dt-subhead-actions">
        <Button variant="ghost" size="sm" icon={<Icon name="plus" />}
          onClick={() => { setOpen(true); onChange([...items, '']) }}>{t('addRow')}</Button>
      </span>
    </div>
    {items.length > LIST_SHOWN && <button type="button" className="dt-textlink dt-rows-summary" aria-expanded={open}
      onClick={() => setOpen(!open)}>
      {open ? t('collapse') : items.join(t('listSeparator'))}
    </button>}
    {(items.length <= LIST_SHOWN || open) && <ul className="dt-rows" style={{ ['--dt-columns' as string]: 1 }}>
      {items.map((item, index) => <li key={index} className="dt-rows-item">
        <Input aria-label={label} placeholder={placeholder} spellCheck={false} value={item}
          onChange={event => set(index, event.target.value)} />
        <Button variant="ghost" size="sm" icon={<Icon name="trash" />} aria-label={t('removeRow', { name: item || label })}
          onClick={() => onChange(items.filter((_, position) => position !== index))} />
      </li>)}
    </ul>}
  </div>
}
