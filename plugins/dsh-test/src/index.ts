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
 */
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildLaunchArgs, preparePort, resolveTargetPort } from './port.js'
import { childEnvironment, errorMessage, terminateProcessTree } from './process.js'
import { createInstanceTools } from './tools.js'
import type { DshTestConfig, DshTestInfo, StandardValidation } from './types.js'
// Cordis 的真实上下文类型；`import type {}` 只拉取 dsh-tools 的 declaration
// merging（ctx.tools），本插件不再手写一份 ToolRegistry/PluginContext。
// The real Cordis context type; the bare type import only pulls the dsh-tools
// declaration merge (ctx.tools), so no hand-written ToolRegistry/PluginContext.
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'

/** Startup line the production web runner prints once its listener is ready. */
const READY_URL_PATTERN = /dsh web: (\S+)/u
/** Characters of trailing subprocess output retained for failure diagnostics. */
const OUTPUT_TAIL_LIMIT = 4000

/** Workspace root containing this plugin (`plugins/<name>` -> workspace root). */
const WORKSPACE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

/**
 * One live `dsh web` child. `phase` separates an in-flight startup, a ready
 * instance, and an intentional stop so late process events cannot rewrite the
 * snapshot of a newer instance.
 */
interface ManagedInstance {
  child: ChildProcess
  phase: 'starting' | 'ready' | 'stopping' | 'stopped'
  outputTail: string
  startupBuffer: string
  timer: ReturnType<typeof setTimeout> | undefined
  settle(): void
}

/**
 * Default DSH_SRC: the first deepseek-harness checkout found beside this
 * plugin's directory, falling back to the workspace root.
 */
function defaultSrcDir(): string {
  const candidates = [
    join(WORKSPACE_ROOT, 'deepseek', 'deepseek-harness'),
    join(WORKSPACE_ROOT, 'deepseek-harness'),
    join(dirname(WORKSPACE_ROOT), 'deepseek-harness'),
  ]
  return candidates.find(candidate => existsSync(join(candidate, 'package.json'))) ?? WORKSPACE_ROOT
}

const CONFIG_DEFAULTS: DshTestConfig = {
  /** Executable that launches the dsh CLI, for example `pnpm` or an absolute `dsh` path. */
  command: 'pnpm',
  /** Arguments after the executable; the default runs the CLI's web runner from source. */
  args: ['dsh', 'web', '--no-open'],
  /** Budget for the subprocess to print its ready URL before the startup fails. */
  startupTimeoutMs: 180_000,
}

/**
 * Configuration for the managed web instance, validated as a Standard Schema so
 * the bundle carries no runtime schema dependency. Deployment-varying choices
 * are config fields changeable from cordis.yml.
 */
export const Config = {
  '~standard': {
    version: 1,
    vendor: 'dsh-test',
    validate(config: unknown): StandardValidation {
      const issues: Array<{ message: string }> = []
      const value: DshTestConfig = { ...CONFIG_DEFAULTS }
      const given = typeof config === 'object' && config !== null ? config as Record<string, unknown> : {}
      const isString = (candidate: unknown): candidate is string => typeof candidate === 'string' && candidate.length > 0

      if (given.command !== undefined) {
        if (!isString(given.command)) issues.push({ message: 'command must be a non-empty string' })
        else value.command = given.command
      }
      if (given.args !== undefined) {
        if (!Array.isArray(given.args) || !given.args.every(isString)) issues.push({ message: 'args must be an array of non-empty strings' })
        else value.args = [...given.args]
      }
      for (const field of ['cwd', 'srcDir', 'dshHome'] as const) {
        if (given[field] !== undefined) {
          if (!isString(given[field])) issues.push({ message: `${field} must be a non-empty string` })
          else value[field] = given[field]
        }
      }
      if (given.port !== undefined) {
        if (typeof given.port !== 'number' || !Number.isInteger(given.port) || given.port < 1 || given.port > 65535) {
          issues.push({ message: 'port must be an integer between 1 and 65535' })
        } else {
          value.port = given.port
        }
      }
      if (given.startupTimeoutMs !== undefined) {
        if (typeof given.startupTimeoutMs !== 'number' || !Number.isFinite(given.startupTimeoutMs) || given.startupTimeoutMs <= 0) {
          issues.push({ message: 'startupTimeoutMs must be a positive finite number' })
        } else {
          value.startupTimeoutMs = given.startupTimeoutMs
        }
      }
      return issues.length > 0 ? { issues } : { value }
    },
  },
} as const

export const inject = ['tools'] as const

/**
 * Spawn the managed web instance and register the instance tools.
 *
 * @param ctx - Cordis context providing the `tools` registry and effect scope.
 * @param config - validated {@link DshTestConfig} values.
 * @returns the effect disposer releasing the tools and the subprocess.
 */
export function apply(ctx: Context, config: DshTestConfig) {
  return ctx.effect(() => {
    const srcDir = config.srcDir ?? defaultSrcDir()
    const dshHome = config.dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
    const cwd = config.cwd ?? srcDir
    const targetPort = resolveTargetPort(config)
    const commandLine = [config.command, ...buildLaunchArgs(config)].join(' ')

    let status: DshTestInfo['STATUS'] = 'starting'
    let webUrl: string | undefined
    let error: string | undefined
    let current: ManagedInstance | undefined
    let disposed = false
    let queue: Promise<unknown> = Promise.resolve()

    const snapshot = (): DshTestInfo => {
      const value: DshTestInfo = { DSH_HOME: dshHome, DSH_SRC: srcDir, STATUS: status }
      if (targetPort !== undefined) value.PORT = targetPort
      if (webUrl !== undefined) value.WEB_URL = webUrl
      if (error !== undefined) value.ERROR = error
      return value
    }

    /** Serialize lifecycle work so two restart calls cannot interleave. */
    const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
      const result = queue.then(task, task)
      queue = result.then(() => undefined, () => undefined)
      return result
    }

    /** Stop the current instance and wait for its process tree to disappear. */
    async function stopCurrent(): Promise<void> {
      const instance = current
      if (instance === undefined) return
      current = undefined
      instance.phase = 'stopped'
      if (instance.timer !== undefined) {
        clearTimeout(instance.timer)
        instance.timer = undefined
      }
      instance.settle()
      await terminateProcessTree(instance.child.pid)
    }

    /** Pre-check the port, spawn one child, and resolve once it is ready or failed. */
    async function startInstance(): Promise<void> {
      if (disposed) return
      status = 'starting'
      webUrl = undefined
      error = undefined
      if (current !== undefined) await stopCurrent()

      try {
        await preparePort(targetPort)
      } catch (cause) {
        if (disposed) return
        status = 'error'
        error = `port pre-check failed for ${targetPort === undefined ? 'the CLI-selected port' : `port ${targetPort}`}: ${errorMessage(cause)}`
        return
      }
      if (disposed) return

      let child: ChildProcess
      try {
        child = spawn(commandLine, {
          cwd,
          shell: process.platform === 'win32',
          windowsHide: true,
          // The reported harness home must also be the one the child uses;
          // otherwise a test instance would write into the host's home. The
          // ambient env is scrubbed like the official subprocess service.
          env: childEnvironment({ DSH_HOME: dshHome }),
          stdio: ['ignore', 'pipe', 'pipe'],
          // POSIX: make the child its own process group so dispose and restart
          // can terminate the whole tree; Windows uses taskkill /T instead.
          detached: process.platform !== 'win32',
        })
      } catch (cause) {
        status = 'error'
        error = `failed to launch "${commandLine}" in ${cwd}: ${errorMessage(cause)}`
        return
      }

      let settleStartup!: () => void
      const startup = new Promise<void>(resolveStartup => {
        settleStartup = resolveStartup
      })
      const instance: ManagedInstance = {
        child,
        phase: 'starting',
        outputTail: '',
        startupBuffer: '',
        timer: undefined,
        settle: settleStartup,
      }
      current = instance

      const finishStartup = (): void => {
        if (instance.timer !== undefined) {
          clearTimeout(instance.timer)
          instance.timer = undefined
        }
        instance.settle()
      }
      const fail = (message: string): void => {
        if (instance.phase !== 'starting' || current !== instance) return
        instance.phase = 'stopping'
        status = 'error'
        webUrl = undefined
        error = message
        // Keep `current` until the tree is gone so a queued restart waits for it.
        void terminateProcessTree(child.pid).finally(() => {
          if (current === instance) current = undefined
          instance.phase = 'stopped'
          finishStartup()
        })
      }

      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        instance.outputTail = (instance.outputTail + chunk).slice(-OUTPUT_TAIL_LIMIT)
        if (instance.phase !== 'starting') return
        instance.startupBuffer = (instance.startupBuffer + chunk).slice(-OUTPUT_TAIL_LIMIT)
        const ready = READY_URL_PATTERN.exec(instance.startupBuffer)
        if (ready === null || ready[1] === undefined) return
        instance.phase = 'ready'
        status = 'ready'
        webUrl = ready[1]
        error = undefined
        finishStartup()
      })
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (chunk: string) => {
        instance.outputTail = (instance.outputTail + chunk).slice(-OUTPUT_TAIL_LIMIT)
      })
      child.on('error', (spawnError: Error) => {
        fail(`failed to launch "${commandLine}" in ${cwd}: ${spawnError.message}`)
      })
      child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
        if (current !== instance || instance.phase === 'stopped' || instance.phase === 'stopping') return
        if (instance.phase === 'starting') {
          fail(
            `"${commandLine}" exited before printing a web URL`
            + ` (code: ${String(code)}, signal: ${String(signal)}).`
            + ` Last output: ${instance.outputTail.trim() || '(none)'}`,
          )
          return
        }
        // A ready instance died on its own: never leave its stale URL behind.
        instance.phase = 'stopping'
        status = 'error'
        webUrl = undefined
        error = `"${commandLine}" exited after becoming ready`
          + ` (code: ${String(code)}, signal: ${String(signal)}).`
          + ` Last output: ${instance.outputTail.trim() || '(none)'}`
        void terminateProcessTree(child.pid).finally(() => {
          if (current === instance) current = undefined
          instance.phase = 'stopped'
        })
      })

      instance.timer = setTimeout(() => {
        fail(
          `"${commandLine}" printed no ready URL within ${config.startupTimeoutMs}ms.`
          + ` Last output: ${instance.outputTail.trim() || '(none)'}`,
        )
      }, config.startupTimeoutMs)

      await startup
    }

    /** Stop the current instance, free the port again, and launch a fresh one. */
    async function restartInstance(): Promise<DshTestInfo> {
      if (disposed) return snapshot()
      status = 'starting'
      webUrl = undefined
      error = undefined
      await stopCurrent()
      if (!disposed) await startInstance()
      return snapshot()
    }

    /** Queue a restart and turn any unexpected lifecycle throw into an ERROR snapshot. */
    async function requestRestart(): Promise<DshTestInfo> {
      try {
        return await enqueue(restartInstance)
      } catch (cause) {
        status = 'error'
        webUrl = undefined
        error = `unexpected restart failure: ${errorMessage(cause)}`
        return snapshot()
      }
    }

    const disposers = createInstanceTools(snapshot, requestRestart)
      .map(definition => ctx.tools.register(definition))
      .reverse()
    void enqueue(startInstance).catch((cause: unknown) => {
      if (status !== 'starting') return
      status = 'error'
      error = `unexpected startup failure: ${errorMessage(cause)}`
    })

    return async () => {
      disposed = true
      // Reverse registration order, then release the process tree and queue.
      for (const dispose of disposers) dispose()
      await stopCurrent()
      await queue.catch(() => undefined)
    }
  })
}
