/**
 * Managed-instance lifecycle: pre-check the port, spawn one `dsh web` child,
 * watch for the ready URL, and stop or restart the process tree. `phase`
 * separates starting/ready/intentional-stop so late process events cannot
 * rewrite a newer instance's snapshot; failures land in ERROR, never thrown.
 * 托管实例生命周期：预检端口、拉起 `dsh web`、监听就绪 URL、停止或重启进程树。
 * `phase` 区分启动中/就绪/主动停止，迟到事件无法改写新实例快照；失败落入 ERROR。
 */
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { childEnvironment, errorMessage, terminateProcessTree } from './process.js'
import { preparePort } from './port.js'
import type { DshTestInfo } from './types.js'

/** Startup line the production web runner prints once its listener is ready. */
const READY_URL_PATTERN = /dsh web: (\S+)/u
/** Characters of trailing subprocess output retained for failure diagnostics. */
const OUTPUT_TAIL_LIMIT = 4000

/** One live `dsh web` child; see the module doc for the `phase` contract. 一个存活的 `dsh web` 子进程；`phase` 契约见模块文档。 */
interface ManagedInstance {
  child: ChildProcess
  phase: 'starting' | 'ready' | 'stopping' | 'stopped'
  outputTail: string
  startupBuffer: string
  timer: ReturnType<typeof setTimeout> | undefined
  settle(): void
  startup: Promise<void>
}

/**
 * Everything the runner needs to launch one managed instance; assembled by
 * `createInstanceRunner` (see `index.ts`).
 * runner 拉起托管实例所需的全部输入；由 `createInstanceRunner` 组装（见
 * `index.ts`）。
 */
export interface LaunchPlan {
  readonly srcDir: string
  readonly dshHome: string
  readonly cwd: string
  readonly targetPort: number | undefined
  readonly commandLine: string
  readonly startupTimeoutMs: number
}

export class InstanceRunner {
  private status: DshTestInfo['STATUS'] = 'starting'
  private webUrl: string | undefined
  private error: string | undefined
  private current: ManagedInstance | undefined
  private disposed = false
  private queue: Promise<unknown> = Promise.resolve()

  constructor(private readonly plan: LaunchPlan) {}

  /** Read-only snapshot of the current instance state. 当前实例状态的只读快照。 */
  snapshot(): DshTestInfo {
    const value: DshTestInfo = { DSH_HOME: this.plan.dshHome, DSH_SRC: this.plan.srcDir, STATUS: this.status }
    if (this.plan.targetPort !== undefined) value.PORT = this.plan.targetPort
    if (this.webUrl !== undefined) value.WEB_URL = this.webUrl
    if (this.error !== undefined) value.ERROR = this.error
    return value
  }

  /** Queue the first startup; unexpected throws land in the ERROR snapshot. 排队首次启动；意外抛错落入 ERROR 快照。 */
  start(): void {
    void this.enqueue(() => this.startInstance()).catch((cause: unknown) => {
      if (this.status !== 'starting') return
      this.status = 'error'
      this.webUrl = undefined
      this.error = `unexpected startup failure: ${errorMessage(cause)}`
    })
  }

  /** Queue a restart and turn any unexpected lifecycle throw into an ERROR snapshot. 排队重启，意外抛错转为 ERROR 快照。 */
  async requestRestart(): Promise<DshTestInfo> {
    try {
      return await this.enqueue(() => this.restartInstance())
    } catch (cause) {
      this.status = 'error'
      this.webUrl = undefined
      this.error = `unexpected restart failure: ${errorMessage(cause)}`
      return this.snapshot()
    }
  }

  /** Forbid further starts or restarts. 禁止后续启动或重启。 */
  markDisposed(): void {
    this.disposed = true
  }

  /** Stop the current instance and drain the lifecycle queue. 停止当前实例并排空生命周期队列。 */
  async dispose(): Promise<void> {
    await this.stopCurrent()
    await this.queue.catch(() => undefined)
  }

  /** Serialize lifecycle work so two restart calls cannot interleave. 串行化生命周期操作。 */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.queue.then(task, task)
    this.queue = result.then(() => undefined, () => undefined)
    return result
  }

  /** Stop the current instance and await its process tree. 停止当前实例并等待进程树消失。 */
  private async stopCurrent(): Promise<void> {
    const instance = this.current
    if (instance === undefined) return
    this.current = undefined
    instance.phase = 'stopped'
    if (instance.timer !== undefined) clearTimeout(instance.timer)
    instance.timer = undefined
    instance.settle()
    await terminateProcessTree(instance.child.pid)
  }

  /** Pre-check the port, spawn one child, resolve once ready or failed. 预检端口、拉起子进程，就绪或失败后 resolve。 */
  private async startInstance(): Promise<void> {
    const instance = await this.prepareStart()
    if (instance === undefined) return
    await instance.startup
  }

  /** Restart: stop the current instance, free the port again, launch fresh. 重启：停当前实例、再放端口、起新实例。 */
  private async restartInstance(): Promise<DshTestInfo> {
    if (this.disposed) return this.snapshot()
    this.status = 'starting'
    this.webUrl = undefined
    this.error = undefined
    await this.stopCurrent()
    if (!this.disposed) await this.startInstance()
    return this.snapshot()
  }

  /** Prepare one fresh start; `undefined` means aborted or already failed. 准备一次全新启动；`undefined` 表示中止或已失败。 */
  private async prepareStart(): Promise<ManagedInstance | undefined> {
    if (this.disposed) return undefined
    this.status = 'starting'
    this.webUrl = undefined
    this.error = undefined
    if (this.current !== undefined) await this.stopCurrent()
    if (!(await this.preparePort())) return undefined
    const child = this.spawnChild()
    if (child === undefined) return undefined
    return this.wireInstance(child)
  }

  /** Free the target port, turning any failure into an ERROR snapshot. 释放目标端口，失败转为 ERROR 快照。 */
  private async preparePort(): Promise<boolean> {
    try {
      await preparePort(this.plan.targetPort)
    } catch (cause) {
      if (this.disposed) return false
      this.status = 'error'
      this.error = `port pre-check failed for ${this.plan.targetPort === undefined ? 'the CLI-selected port' : `port ${this.plan.targetPort}`}: ${errorMessage(cause)}`
      return false
    }
    return !this.disposed
  }

  /** Spawn one child; `undefined` means the launch failed. 拉起一个子进程；`undefined` 表示启动失败。 */
  private spawnChild(): ChildProcess | undefined {
    try {
      return spawn(this.plan.commandLine, {
        cwd: this.plan.cwd,
        shell: process.platform === 'win32',
        windowsHide: true,
        // The reported harness home must be the one the child uses; the ambient
        // env is scrubbed like the official subprocess service.
        // 上报的 harness home 必须就是子进程所用的那个；环境按官方 subprocess service 净洗。
        env: childEnvironment({ DSH_HOME: this.plan.dshHome }),
        stdio: ['ignore', 'pipe', 'pipe'],
        // POSIX: own process group so dispose/restart kill the whole tree; Windows uses taskkill /T.
        // POSIX：子进程自成进程组，dispose/restart 可终止整棵树；Windows 用 taskkill /T。
        detached: process.platform !== 'win32',
      })
    } catch (cause) {
      this.status = 'error'
      this.error = `failed to launch "${this.plan.commandLine}" in ${this.plan.cwd}: ${errorMessage(cause)}`
      return undefined
    }
  }

  /** Create the instance record and wire its stdout/stderr/exit handlers. 创建实例记录并挂接 stdout/stderr/exit 监听。 */
  private wireInstance(child: ChildProcess): ManagedInstance {
    let settleStartup!: () => void
    const startup = new Promise<void>(resolveStartup => { settleStartup = resolveStartup })
    const instance: ManagedInstance = {
      child,
      phase: 'starting',
      outputTail: '',
      startupBuffer: '',
      timer: undefined,
      settle: settleStartup,
      startup,
    }
    this.current = instance
    this.attachOutputHandlers(instance, child)
    child.on('error', (spawnError: Error) => {
      this.failStartup(instance, `failed to launch "${this.plan.commandLine}" in ${this.plan.cwd}: ${spawnError.message}`)
    })
    child.on('exit', (code: number | null, signal: NodeJS.Signals | null) => {
      this.onExit(instance, code, signal)
    })
    instance.timer = this.armStartupTimeout(instance)
    return instance
  }

  /** Wire the child's stdout/stderr: keep the diagnostic tail. 挂接子进程 stdout/stderr：保留诊断尾部。 */
  private attachOutputHandlers(instance: ManagedInstance, child: ChildProcess): void {
    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => this.onStdout(instance, chunk))
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      instance.outputTail = (instance.outputTail + chunk).slice(-OUTPUT_TAIL_LIMIT)
    })
  }

  /** Arm the startup watchdog: no ready URL in budget fails the instance. 设置启动看门狗：预算内没有就绪 URL 即失败。 */
  private armStartupTimeout(instance: ManagedInstance): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      this.failStartup(
        instance,
        `"${this.plan.commandLine}" printed no ready URL within ${this.plan.startupTimeoutMs}ms.`
        + ` Last output: ${instance.outputTail.trim() || '(none)'}`,
      )
    }, this.plan.startupTimeoutMs)
  }

  /** Clear the startup timer and settle the startup promise. 清除启动定时器并落定启动 promise。 */
  private finishStartup(instance: ManagedInstance): void {
    if (instance.timer !== undefined) clearTimeout(instance.timer)
    instance.timer = undefined
    instance.settle()
  }

  /** Fail a still-starting instance and tear its process tree down. 让仍在启动的实例失败并拆掉其进程树。 */
  private failStartup(instance: ManagedInstance, message: string): void {
    if (instance.phase !== 'starting' || this.current !== instance) return
    instance.phase = 'stopping'
    this.status = 'error'
    this.webUrl = undefined
    this.error = message
    // Keep `current` until the tree is gone so a queued restart waits for it.
    // 在进程树消失前保留 `current`，让排队中的重启等它。
    void terminateProcessTree(instance.child.pid).finally(() => {
      if (this.current === instance) this.current = undefined
      instance.phase = 'stopped'
      this.finishStartup(instance)
    })
  }

  /** Stdout: keep the tail, and promote a ready URL to a ready instance. stdout：保留尾部，并把就绪 URL 提升为就绪实例。 */
  private onStdout(instance: ManagedInstance, chunk: string): void {
    instance.outputTail = (instance.outputTail + chunk).slice(-OUTPUT_TAIL_LIMIT)
    if (instance.phase !== 'starting') return
    instance.startupBuffer = (instance.startupBuffer + chunk).slice(-OUTPUT_TAIL_LIMIT)
    const ready = READY_URL_PATTERN.exec(instance.startupBuffer)
    if (ready === null || ready[1] === undefined) return
    instance.phase = 'ready'
    this.status = 'ready'
    this.webUrl = ready[1]
    this.error = undefined
    this.finishStartup(instance)
  }

  /** Exit of a child that was not intentionally stopped. 非主动停止的子进程退出。 */
  private onExit(instance: ManagedInstance, code: number | null, signal: NodeJS.Signals | null): void {
    if (this.current !== instance || instance.phase === 'stopped' || instance.phase === 'stopping') return
    if (instance.phase === 'starting') {
      this.failStartup(
        instance,
        `"${this.plan.commandLine}" exited before printing a web URL`
        + ` (code: ${String(code)}, signal: ${String(signal)}).`
        + ` Last output: ${instance.outputTail.trim() || '(none)'}`,
      )
      return
    }
    // A ready instance died on its own: never leave its stale URL behind.
    // 就绪实例自行死亡：绝不留下过期 URL。
    instance.phase = 'stopping'
    this.status = 'error'
    this.webUrl = undefined
    this.error = `"${this.plan.commandLine}" exited after becoming ready`
      + ` (code: ${String(code)}, signal: ${String(signal)}).`
      + ` Last output: ${instance.outputTail.trim() || '(none)'}`
    void terminateProcessTree(instance.child.pid).finally(() => {
      if (this.current === instance) this.current = undefined
      instance.phase = 'stopped'
    })
  }
}
