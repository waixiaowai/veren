/**
 * dsh-test: managed dsh profile web instance for testing other plugins.
 *
 * On activation this plugin frees the target port when one is known, spawns a
 * configurable `dsh web` command, and records the token URL the CLI prints once
 * the listener is ready. Two tools expose the instance:
 * `get_dsh_test_info` reports the live STATUS/WEB_URL/ERROR snapshot and
 * `restart_dsh_test` stops the process tree and starts a fresh instance.
 * Startup and restart failures land in the ERROR field instead of throwing into
 * the tool pipeline.
 *
 * Configuration lives in `./config.js`, the instance lifecycle in
 * `./instance.js`; this module only declares the plugin surface and wires the
 * tools to the runner.
 *
 * 配置在 `./config.js`，实例生命周期在 `./instance.js`；本模块只声明插件面，并把
 * 工具接到 runner 上。
 */
// Cordis 的真实上下文类型；`import type {}` 只拉取 dsh-tools 的 declaration
// merging（ctx.tools），本插件不再手写一份 ToolRegistry/PluginContext。
// The real Cordis context type; the bare type import only pulls the dsh-tools
// declaration merge (ctx.tools), so no hand-written ToolRegistry/PluginContext.
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'
import type { DshTestConfig } from './types.js'
import { createInstanceRunner, type InstanceRunner } from './instance.js'
import { createInstanceTools } from './tools.js'

export { Config } from './config.js'
export { defaultSrcDir } from './config.js'

export const inject = ['tools'] as const

/**
 * Wire one runner's tools in reverse-disposer order.
 *
 * 以逆序 disposer 方式接入一个 runner 的工具。
 *
 * @param ctx - Cordis context providing the `tools` registry and effect scope.
 * @param runner - the managed instance lifecycle owner. 托管实例生命周期的持有者。
 * @returns the tool disposers in reverse registration order. 逆注册顺序的工具 disposer。
 */
function registerInstanceTools(ctx: Context, runner: InstanceRunner): Array<() => void> {
  return createInstanceTools(() => runner.snapshot(), () => runner.requestRestart())
    .map(definition => ctx.tools.register(definition))
    .reverse()
}

/**
 * Spawn the managed web instance and register the instance tools.
 *
 * @param ctx - Cordis context providing the `tools` registry and effect scope.
 * @param config - validated {@link DshTestConfig} values.
 * @returns the effect disposer releasing the tools and the subprocess.
 */
export function apply(ctx: Context, config: DshTestConfig) {
  return ctx.effect(() => {
    const runner = createInstanceRunner(config)
    const disposers = registerInstanceTools(ctx, runner)
    runner.start()
    return async () => {
      // Reverse registration order, then release the process tree and queue.
      // 先按逆注册顺序移除工具，再释放进程树与队列。
      runner.markDisposed()
      for (const dispose of disposers) dispose()
      await runner.dispose()
    }
  })
}
