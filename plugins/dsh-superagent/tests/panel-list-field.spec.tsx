// @vitest-environment jsdom
// The plain string list field: what the panel submits must be the shape the Source's own schema stores.
import { act, useState, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { expect, it } from 'vitest'
import { zh } from '../src/client/locales.ts'
import { PanelProvider } from '../src/client/provider.tsx'
import { SourceField } from '../src/client/settings-kit.tsx'
import { taskhubKind } from '../src/sources/taskhub.ts'
import { all, click, find, settle, translator, type } from './fixtures/panel.tsx'
import { usePanelServer } from './fixtures/panel-server.ts'

let root: Root | undefined, container: HTMLElement | undefined
const unmount = () => { if (root) act(() => { root!.unmount() }); root = undefined; container?.remove() }
usePanelServer(unmount)

const TAGS = taskhubKind.fields.find(field => field.key === 'tags')!
const boxes = () => all('.dt-rows-item input') as HTMLInputElement[]
/** The tags field on its own, holding the value the panel would save. */
function Harness({ onEdit }: { onEdit: (next: string[]) => void }) {
  const [value, setValue] = useState<unknown>(['loomart'])
  return <PanelProvider t={translator(zh)}>
    <SourceField field={TAGS} value={value} saved={value} fact={undefined} labels={{}}
      onChange={next => { setValue(next); onEdit(next as string[]) }} />
  </PanelProvider>
}
async function render(node: ReactElement) {
  container = document.createElement('div'); document.body.append(container)
  root = createRoot(container)
  await act(async () => { root!.render(node) })
  await settle()
}

it('edits the routing tags as the plain string list its schema stores, not as records', async () => {
  const edited: string[][] = []
  await render(<Harness onEdit={next => edited.push(next)} />)
  expect(boxes().map(box => box.value)).toEqual(['loomart'])
  await click(zh.addRow)
  expect(boxes().map(box => box.value)).toEqual(['loomart', ''])
  await type(boxes()[1]!, '编码')
  expect(edited.at(-1)).toEqual(['loomart', '编码'])
  // A `rows` field would have submitted `{ id: '编码' }`, which the schema refuses as `tags.0`.
  expect(taskhubKind.schema.safeParse({ tags: edited.at(-1) }).success).toBe(true)
  await click(find(zh.removeRow.replace('{name}', '编码')))
  expect(edited.at(-1)).toEqual(['loomart'])
})
