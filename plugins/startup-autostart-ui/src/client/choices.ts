/**
 * The dropdown option sources for the detail form: agent presets and models.
 *
 * One source serves the whole page: it reads the agent-preset roster and the
 * session model catalog through the Host's own Remote namespaces (the same
 * reads the shipped preset picker and model selector use), derives flat option
 * lists, and re-reads when a connection reset, an adapter update, or a
 * settings-document update invalidates them. Its observable follows the same
 * rule as the item catalog: the snapshot keeps its identity until a fact moves.
 *
 * 详情表单下拉的选项来源：agent 预设与模型。一个源服务整个页面：通过宿主自身的
 * Remote 命名空间读取 agent 预设名册与会话模型目录（与自带预设选择器、模型选择器
 * 相同的读取），派生出扁平选项列表，并在连接重置、适配器更新或设置文档更新使其
 * 失效时重读。可观察对象与启动项目录遵循同一规则：事实未变时快照引用保持不变。
 *
 * 实现按步骤拆分：广播、读取、订阅/退订各自是模块级函数，经 ChoicesState 共享
 * 可变状态。
 * The implementation is split by step: publish, read, and subscribe/unsubscribe
 * are module-level functions sharing mutable state through ChoicesState.
 *
 * @module @veren/startup-autostart/client/choices
 */

import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/** One selectable value shown in a detail-form dropdown. */
export interface StartupChoiceOption {
  /** Value stored in the item field (the preset id or an unset marker). */
  readonly value: string
  /** User-visible label; the id is the fallback. */
  readonly label: string
  /** Optional second line, e.g. a preset description. */
  readonly hint?: string
}

/** One selectable model route for the model dropdown. */
export interface StartupModelOption {
  /** Provider route name stored in the item. */
  readonly provider: string
  /** Model id stored in the item. */
  readonly model: string
  /** User-visible label: "provider / model". */
  readonly label: string
}

/** What the detail form renders for its dropdowns. */
export interface StartupChoicesSnapshot {
  /** Healthy presets in roster order; broken presets are never offered. */
  readonly presets: readonly StartupChoiceOption[]
  /** Advertised model routes in catalog order. */
  readonly models: readonly StartupModelOption[]
  /** Read state; a refresh republishes `loading` over the previous options. */
  readonly status: 'loading' | 'ready' | 'error'
}

/** The Remote reads and the invalidations the choices source follows. */
export interface StartupChoicesDeps {
  /** Read the agent-preset roster (`agentPresets.list`). */
  readonly listPresets: () => Promise<{ readonly ok: boolean; readonly value?: { readonly presets: readonly { readonly id: string; readonly name?: string; readonly description?: string; readonly broken?: string }[] } }>
  /** Read the model catalog (`session.modelCatalog`). */
  readonly listModels: () => Promise<{ readonly ok: boolean; readonly value?: { readonly groups: readonly { readonly id: string; readonly name: string; readonly models: readonly { readonly id: string; readonly name: string }[] }[] } }>
  /** Subscribe to any event that invalidates both reads. */
  readonly subscribeInvalidate: (listener: () => void) => () => void
}

/** Choices observable. Options are plain data; the form never re-fetches. */
export interface StartupChoices {
  /** Observable snapshot consumed through an injected hook. */
  readonly source: HostObservable<StartupChoicesSnapshot>
}

/** 选项源的内部可变状态。Internal mutable state of the choices source. */
interface ChoicesState {
  snapshot: StartupChoicesSnapshot
  disposers: (() => void)[]
  epoch: number
  inflight: Promise<void> | undefined
  readonly registry: Set<() => void>
}

/** 初值/复位快照；每次调用都给新对象，保持原来的引用语义。The initial/reset snapshot; a new object per call keeps the original reference semantics. */
const initialSnapshot = (): StartupChoicesSnapshot => ({ presets: [], models: [], status: 'loading' })

/** 向全部监听者广播一次快照更新。Broadcast one snapshot update to every listener. */
function publishSnapshot(state: ChoicesState, next: Partial<StartupChoicesSnapshot>): void {
  state.snapshot = { ...state.snapshot, ...next }
  for (const listener of [...state.registry]) listener()
}

/** Healthy presets as dropdown options, in roster order. */
function presetOptions(presets: readonly { readonly id: string; readonly name?: string; readonly description?: string; readonly broken?: string }[]): StartupChoiceOption[] {
  return presets.filter(preset => preset.broken === undefined).map(preset => ({
    value: preset.id,
    label: preset.name ?? preset.id,
    ...(preset.description === undefined ? {} : { hint: preset.description }),
  }))
}

/** Advertised models as dropdown options, in catalog order. */
function modelOptions(groups: readonly { readonly id: string; readonly name: string; readonly models: readonly { readonly id: string; readonly name: string }[] }[]): StartupModelOption[] {
  return groups.flatMap(group => group.models.map(model => ({
    provider: group.id,
    model: model.id,
    label: `${group.name} / ${model.name}`,
  })))
}

/**
 * 读一次两路 Remote：任一路失败即报错，双路成功才发布派生选项。
 * Read both Remotes once: any failed read publishes the error, and only a
 * doubly successful read publishes the derived options.
 */
function readChoices(deps: StartupChoicesDeps, state: ChoicesState): Promise<void> {
  if (state.inflight !== undefined) return state.inflight
  const mine = state.epoch
  publishSnapshot(state, { status: 'loading' })
  state.inflight = Promise.all([deps.listPresets(), deps.listModels()]).then(
    ([presets, models]) => {
      if (mine !== state.epoch) return
      if (!presets.ok || presets.value === undefined || !models.ok || models.value === undefined) {
        publishSnapshot(state, { status: 'error' })
        return
      }
      publishSnapshot(state, {
        presets: presetOptions(presets.value.presets),
        models: modelOptions(models.value.groups),
        status: 'ready',
      })
    },
    () => {
      if (mine === state.epoch) publishSnapshot(state, { status: 'error' })
    },
  ).finally(() => {
    if (mine === state.epoch) state.inflight = undefined
  })
  return state.inflight
}

/** 末位退订：逆序清理失效源、前进 epoch 并复位快照。Last unsubscribe: unwind the invalidation sources in reverse, advance the epoch, and reset the snapshot. */
function unsubscribeChoices(state: ChoicesState, listener: () => void): void {
  state.registry.delete(listener)
  if (state.registry.size !== 0) return
  for (const dispose of state.disposers) dispose()
  state.disposers = []
  state.epoch += 1
  state.inflight = undefined
  state.snapshot = initialSnapshot()
}

/** 首订阅登记失效源并首读，返回退订句柄。The first subscriber registers the invalidation source and starts the first read; returns the unsubscriber. */
function subscribeChoices(deps: StartupChoicesDeps, state: ChoicesState, listener: () => void): () => void {
  state.registry.add(listener)
  if (state.registry.size === 1) {
    state.disposers = [deps.subscribeInvalidate(() => { void readChoices(deps, state) })]
    void readChoices(deps, state)
  }
  return () => { unsubscribeChoices(state, listener) }
}

/**
 * Build the choices source over the two Remote reads.
 * @param deps - reads and the shared invalidation subscription.
 * @returns the observable the panel injects into the detail form.
 */
export function createStartupChoices(deps: StartupChoicesDeps): StartupChoices {
  const state: ChoicesState = { snapshot: initialSnapshot(), disposers: [], epoch: 0, inflight: undefined, registry: new Set() }
  return {
    source: {
      getSnapshot: () => state.snapshot,
      subscribe: listener => subscribeChoices(deps, state, listener),
    },
  }
}
