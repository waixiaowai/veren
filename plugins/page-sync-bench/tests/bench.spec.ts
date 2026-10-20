import { describe, expect, it } from 'vitest'
import { MessageHost, renderSync } from '@veren/prompt-host-messages'
import { TaskListPage, dispatchTool } from '../src/page.ts'
import { TaskStore, makeList } from '../src/store.ts'
import { assemblePageSession } from '../src/driver.ts'
import type { TaskItem } from '../src/types.ts'

describe('store', () => {
  it('鎸夐挳鐘舵€佽縼绉绘牎楠岋細open鈫抰aken鈫抎one锛岄潪娉曡縼绉?fail loud', () => {
    const store = new TaskStore(makeList(5))
    expect(store.takeTask('t-1', 'model').ok).toBe(true)
    expect(store.takeTask('t-1', 'model')).toMatchObject({ ok: false, code: 'invalid_transition' })
    expect(store.completeTask('t-1').ok).toBe(true)
    expect(store.completeTask('t-1')).toMatchObject({ ok: false, code: 'invalid_transition' })
    expect(store.takeTask('t-999', 'model')).toMatchObject({ ok: false, code: 'task_not_found' })
  })

  it('涓嶅彲鍙樼邯寰嬶細getState 寮曠敤鍦ㄦ棤鍙樺寲鏃朵繚鎸佺ǔ瀹氾紙memo bailout 渚濊禆锛?, () => {
    const store = new TaskStore(makeList(3))
    const before = store.getState()
    store.takeTask('t-0', 'u-1')
    expect(store.getState()).not.toBe(before)
    expect(store.getState().find((task) => task.id === 't-0')?.status).toBe('taken')
  })
})

describe('page + host integration (缁勪欢鍖栧叏閾捐矾)', () => {
  it('鍚屽唴瀹归噸澶嶆覆鏌?鈫?memo bailout 鈫?闆?op锛涘彉鍖?鈫?浠呭樊閲?splice', () => {
    const store = new TaskStore(makeList(3))
    const host = assemblePageSession(store)
    const vMount = host.currentVersion
    const opsOf = (): number => {
      const sync = host.renderSince(vMount)
      return sync.kind === 'patch' ? sync.ops.length : Number.POSITIVE_INFINITY
    }
    expect(opsOf()).toBe(0) // 鎸傝浇鍚庢棤鍙樺寲

    store.takeTask('t-1', 'u-1') // 瑙﹀彂閲嶆覆鏌?鈫?浠?1 鏉?splice
    expect(opsOf()).toBe(1)

    const sync = host.renderSince(vMount)
    expect(sync.kind).toBe('patch')
    if (sync.kind === 'patch') {
      expect(sync.ops[0]).toMatchObject({ op: 'splice', path: 'tasks', id: 't-1' })
    }
  })

  it('TaskListPage 鏄粍浠讹細杈撳嚭闈欐€佸ご + keyed 浠诲姟琛?, () => {
    const elements = TaskListPage({ items: makeList(2) })
    expect(elements[0].type).toBe('static')
    expect(elements[1].key).toBe('t-0')
    expect(elements[2].type).toBe('item')
  })

  it('鍏ㄩ噺蹇収妯″紡锛歳enderSince(undefined) 鎼哄甫闈欐€佸ご涓庨泦鍚?, () => {
    const store = new TaskStore(makeList(2))
    const host = assemblePageSession(store)
    const sync = host.renderSince(undefined)
    expect(sync.kind).toBe('snapshot')
    const text = renderSync(sync)
    expect(text.startsWith('SNAPSHOT v')).toBe(true)
    expect(text).toContain('"content":"浠诲姟涓績 路 鍒楄〃椤?')
  })
})

describe('protocol', () => {
  it('dispatch锛欽SON 瑙ｆ瀽澶辫触涓庢湭鐭ュ伐鍏疯繑鍥炵粨鏋勫寲閿欒', () => {
    const store = new TaskStore(makeList(3))
    expect(dispatchTool(store, 'take_task', 'not-json')).toMatchObject({ ok: false, code: 'bad_arguments' })
    expect(dispatchTool(store, 'nope', '{}')).toMatchObject({ ok: false, code: 'unknown_tool' })
    expect(dispatchTool(store, 'take_task', '{"task_id":"t-0"}').ok).toBe(true)
  })

  it('宸ュ叿琛ㄩ潤鎬侊細绯荤粺鎻愮ず璇嶄笉鍚换浣曚换鍔℃暟鎹?, () => {
    const elements = TaskListPage({ items: makeList(1) })
    expect(String(elements[0].props.content)).not.toContain('t-0')
  })
})

describe('types', () => {
  it('TaskItem 缁撴瀯鍐掔儫', () => {
    const task: TaskItem = makeList(1)[0]
    expect(task.id).toBe('t-0')
  })
})
