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
 * Build the choices source over the two Remote reads.
 * @param deps - reads and the shared invalidation subscription.
 * @returns the observable the panel injects into the detail form.
 */
export function createStartupChoices(deps: StartupChoicesDeps): StartupChoices {
  let snapshot: StartupChoicesSnapshot = { presets: [], models: [], status: 'loading' }
  let disposers: (() => void)[] = []
  let epoch = 0
  let inflight: Promise<void> | undefined
  const registry = new Set<() => void>()

  const publish = (next: Partial<StartupChoicesSnapshot>): void => {
    snapshot = { ...snapshot, ...next }
    for (const listener of [...registry]) listener()
  }

  const read = (): Promise<void> => {
    if (inflight !== undefined) return inflight
    const mine = epoch
    publish({ status: 'loading' })
    inflight = Promise.all([deps.listPresets(), deps.listModels()]).then(
      ([presets, models]) => {
        if (mine !== epoch) return
        if (!presets.ok || presets.value === undefined || !models.ok || models.value === undefined) {
          publish({ status: 'error' })
          return
        }
        publish({
          presets: presetOptions(presets.value.presets),
          models: modelOptions(models.value.groups),
          status: 'ready',
        })
      },
      () => {
        if (mine === epoch) publish({ status: 'error' })
      },
    ).finally(() => {
      if (mine === epoch) inflight = undefined
    })
    return inflight
  }

  return {
    source: {
      getSnapshot: () => snapshot,
      subscribe(listener) {
        registry.add(listener)
        if (registry.size === 1) {
          disposers = [deps.subscribeInvalidate(() => { void read() })]
          void read()
        }
        return () => {
          registry.delete(listener)
          if (registry.size !== 0) return
          for (const dispose of disposers) dispose()
          disposers = []
          epoch += 1
          inflight = undefined
          snapshot = { presets: [], models: [], status: 'loading' }
        }
      },
    },
  }
}
