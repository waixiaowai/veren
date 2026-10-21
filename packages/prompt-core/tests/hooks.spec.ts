/**
 * hooks 槽位（C2/C3/C4）单元测试：状态持久、dispatch 重渲通道、调用序守卫、
 * memo bailout 槽位保留、context 栈、假值与文本规范化（C1）。
 * Hook slot unit tests (C2/C3/C4): state persistence, dispatch re-render channel,
 * call-order guards, memo bailout slot retention, context stack, falsy/text
 * normalization (C1).
 *
 * 注意：createElement 是两参形式（children 走 props.children，与 JSX automatic
 * runtime 一致）；root.current.child 是页组件 fiber，宿主 fiber 在其 child。
 * Note: createElement takes two params (children ride props.children, matching
 * the JSX automatic runtime); root.current.child is the page-component fiber and
 * host fibers live under its child.
 */
import { describe, expect, it } from 'vitest'
import {
  createElement,
  createContext,
  createRoot,
  memo,
  normalizeChildren,
  provideContext,
  runWithHookScope,
  scheduleRender,
  useContext,
  useMemo,
  useState,
  useSlot,
} from '../src/index.ts'
import type { PromptHost, PromptRoot } from '../src/index.ts'

/** 记录型宿主：append 的块按序收集 / recording host: appended blocks collected in order */
function recordingHost() {
  const blocks: Array<{ kind: string; key?: string; props: Record<string, unknown> }> = []
  const host: PromptHost = {
    append: (instance) => blocks.push({ kind: instance.kind, key: instance.key, props: instance.props }),
  }
  return { host, blocks }
}

/** 挂一个组件并渲染一帧；refresh 已接到"重跑同组件"（dispatch 通道可用）
 * / mount a component and render one frame; refresh is wired to "re-run the same component" (dispatch channel usable) */
function render(component: (props: Record<string, unknown>, ctx?: unknown) => unknown, props: Record<string, unknown> = {}, ctx?: unknown): PromptRoot {
  const { host } = recordingHost()
  const root = createRoot(host)
  root.componentCtx = ctx
  const rerun = (): void => scheduleRender(root, createElement(component as never, props))
  root.refresh = rerun
  rerun()
  return root
}

/** 页组件 fiber 下的首个宿主 fiber / the first host fiber under the page-component fiber */
function firstHost(root: PromptRoot): { kind: string; key?: string; props: Record<string, unknown> } {
  const fiber = root.current!.child!.child!
  return { kind: fiber.instance!.kind, key: fiber.instance!.key, props: fiber.instance!.props }
}

describe('C1 children normalization', () => {
  it('假值被跳过，字符串/数字包成 text 块，嵌套数组深压平', () => {
    const elements = normalizeChildren([
      '标题',
      false && createElement('p'),
      null,
      undefined,
      42,
      createElement('li', { key: 'a' }),
      ['内', createElement('li', { key: 'b' }), true],
    ])
    expect(elements).toHaveLength(5)
    expect(elements[0]).toMatchObject({ type: 'text', props: { content: '标题' } })
    expect(elements[1]).toMatchObject({ type: 'text', props: { content: '42' } })
    expect(elements[2]).toMatchObject({ type: 'li', key: 'a' })
    expect(elements[3]).toMatchObject({ type: 'text', props: { content: '内' } })
    expect(elements[4]).toMatchObject({ type: 'li', key: 'b' })
  })

  it('组件产出的假值子节点在 reconcile 中被跳过', () => {
    const Page = () =>
      createElement('ul', { children: [createElement('li', { key: 'a' }), null, false] })
    const { blocks } = recordingHost()
    const root = createRoot({ append: (i) => void blocks.push(i as never) })
    scheduleRender(root, createElement(Page))
    // ul 宿主块也在场（无 key）；li 只剩 'a'，假值未产生块 / the ul block is present (keyless); only li 'a' remains — falsy produced no blocks
    expect(blocks.filter((b) => b.kind === 'li').map((b) => b.key)).toEqual(['a'])
  })

  it('组件返回单个元素（非数组）也能对账，文本成为 text 块', () => {
    const Page = () => createElement('p', { children: '单元素' })
    const { blocks } = recordingHost()
    const root = createRoot({ append: (i) => void blocks.push(i as never) })
    scheduleRender(root, createElement(Page))
    expect(blocks.map((b) => b.kind)).toEqual(['p', 'text'])
  })
})

describe('C2 useState', () => {
  it('状态跨渲染持久；dispatch 经 refresh 通道触发重渲', () => {
    let renders = 0
    let bump: (() => void) | undefined
    const Counter = () => {
      renders++
      const [count, setCount] = useState(0)
      bump = () => setCount((prev) => prev + 1)
      return createElement('p', { children: '', count })
    }
    const root = render(Counter)
    expect(renders).toBe(1)
    bump!()
    expect(renders).toBe(2)
    expect(firstHost(root).props.count).toBe(1)
  })

  it('dispatch 值不变不触发重渲', () => {
    let renders = 0
    let setSame: ((v: number) => void) | undefined
    const Counter = () => {
      renders++
      const [count, setCount] = useState(7)
      setSame = (v: number) => setCount(v)
      return createElement('p', { children: '', count })
    }
    const root = render(Counter)
    const before = root.current
    setSame!(7)
    expect(renders).toBe(1)
    expect(root.current).toBe(before)
  })

  it('refresh 未接线时 dispatch 静默不炸', () => {
    const Page = () => {
      const [, set] = useState(0)
      set(1) // root 无 refresh → 不炸、不调度
      return createElement('p', { children: '' })
    }
    const root = createRoot({ append: () => undefined })
    expect(() => scheduleRender(root, createElement(Page))).not.toThrow()
  })
})

describe('C2 调用序守卫', () => {
  it('重渲出现新槽位 fail loud', () => {
    let flip = false
    let rerender: (() => void) | undefined
    const Broken = () => {
      const [n] = useState(1)
      rerender = () => { flip = true }
      if (flip) useState(2) // 第二次渲染才出现的槽位 = 调用序被打破
      return createElement('p', { children: '', n })
    }
    const root = render(Broken)
    rerender!()
    expect(() => scheduleRender(root, createElement(Broken))).toThrowError(/new hook slot appeared/)
  })

  it('渲染外调用 hooks fail loud', () => {
    expect(() => useState(1)).toThrowError(/outside a component render/)
  })

  it('同位置槽位种类变化 fail loud', () => {
    let flip = false
    let rerender: (() => void) | undefined
    const Broken = () => {
      rerender = () => { flip = true }
      if (flip) useMemo(() => 1, [])
      else useState(1)
      return createElement('p', { children: '' })
    }
    const root = render(Broken)
    rerender!()
    expect(() => scheduleRender(root, createElement(Broken))).toThrowError(/hook order changed/)
  })
})

describe('C2 组件第二参数 ctx 透传', () => {
  it('root.componentCtx 作为第二参数到达组件', () => {
    let seen: unknown
    const Page = (_props: Record<string, unknown>, ctx?: unknown) => {
      seen = ctx
      return createElement('p', { children: '' })
    }
    const ctx = { marker: 'page-facade' }
    const root = createRoot({ append: () => undefined })
    root.componentCtx = ctx
    scheduleRender(root, createElement(Page))
    expect(seen).toBe(ctx)
  })
})

describe('C3 memo bailout × hooks', () => {
  it('bail out 子树复用，槽位保留（state 不丢、内层不重跑）', () => {
    let outerRenders = 0
    let innerRenders = 0
    const Inner = memo((props: { n: number }) => {
      innerRenders++
      const [v] = useState(props.n * 10)
      return createElement('p', { children: '', v })
    })
    const Outer = (props: { other: number }) => {
      outerRenders++
      return createElement('div', { children: [createElement(Inner, { n: 1 }), createElement('span', { other: props.other })] })
    }
    const { host } = recordingHost()
    const root = createRoot(host)
    scheduleRender(root, createElement(Outer, { other: 1 }))
    expect(innerRenders).toBe(1)
    scheduleRender(root, createElement(Outer, { other: 2 })) // Inner props 未变 → bail out
    expect(outerRenders).toBe(2)
    expect(innerRenders).toBe(1)
  })
})

describe('C4 context 栈', () => {
  it('provideContext 压栈、useContext 读最近值、无 Provider 用默认', () => {
    const Ctx = createContext('default')
    const nested = provideContext(Ctx, 'outer', () =>
      provideContext(Ctx, 'inner', () => runWithHookScope(null, [], () => useContext(Ctx))),
    )
    expect(nested).toBe('inner')
    const Reader = () => {
      const v = useContext(Ctx)
      return createElement('p', { children: '', v })
    }
    const root = createRoot({ append: () => undefined })
    scheduleRender(root, createElement(Reader))
    expect(firstHost(root).props.v).toBe('default')
  })
})

describe('useMemo / useSlot', () => {
  it('deps 不变不重算，deps 变化重算', () => {
    let computes = 0
    let setN: ((n: number) => void) | undefined
    const Comp = () => {
      const [n, set] = useState(1)
      setN = set
      const derived = useMemo(() => { computes++; return n * 2 }, [n])
      return createElement('p', { children: '', derived })
    }
    const root = render(Comp)
    expect(computes).toBe(1)
    setN!(3) // deps 变化 → refresh → 重算
    expect(computes).toBe(2)
    expect(firstHost(root).props.derived).toBe(6)
  })

  it('useSlot 跨渲染持久（同一槽位对象）', () => {
    let seq = 0
    let rerender: (() => void) | undefined
    const ids: number[] = []
    const Comp = () => {
      const slot = useSlot(() => ({ id: ++seq }))
      ids.push(slot.current.id)
      rerender = () => scheduleRender(root, createElement(Comp))
      return createElement('p', { children: '' })
    }
    const root = createRoot({ append: () => undefined })
    scheduleRender(root, createElement(Comp))
    rerender!()
    expect(ids).toEqual([1, 1])
  })
})
