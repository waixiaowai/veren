/**
 * Child-process helpers for the managed web instance: run short diagnostic
 * commands, wait for a PID with a bounded budget, and terminate a spawned
 * process tree on both Windows and POSIX.
 */
import { spawn } from 'node:child_process'

/** Bytes of a diagnostic command's output retained for error messages. */
const COMMAND_OUTPUT_LIMIT = 64 * 1024
/** Credential-shaped environment names never forwarded to the managed child. */
const SENSITIVE_ENV_PATTERN = /KEY|PASSWORD|SECRET|TOKEN/iu
/** Namespace prefix reserved for Harness-managed child environment facts. */
const DSH_ENV_PREFIX = 'DSH_'

/** Result of one bounded diagnostic command; `missing` marks a missing executable. */
export interface CommandResult {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
  readonly missing: boolean
  readonly timedOut: boolean
}

/** @param cause - thrown value from a process helper or command. */
export function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * Build the managed child's environment. Ambient credential-shaped names and all
 * `DSH_*` facts are removed, then explicit overrides are merged with Windows'
 * case-insensitive key semantics. This mirrors the official
 * `@deepseek-ai/dsh-subprocess` `scrubbedParentEnv`/`childEnv` pair without
 * taking a runtime dependency on that package.
 *
 * @param overrides - deliberate child-only entries such as `DSH_HOME`.
 */
export function childEnvironment(overrides: Readonly<Record<string, string>>): NodeJS.ProcessEnv {
  const base: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue
    if (SENSITIVE_ENV_PATTERN.test(key)) continue
    if (key.toUpperCase().startsWith(DSH_ENV_PREFIX)) continue
    base[key] = value
  }
  if (process.platform !== 'win32') return { ...base, ...overrides }

  const entries = Object.entries(base)
  for (const [key, value] of Object.entries(overrides)) {
    const normalized = key.toUpperCase()
    const index = entries.findIndex(([inherited]) => inherited.toUpperCase() === normalized)
    if (index >= 0) entries[index] = [key, value]
    else entries.push([key, value])
  }
  return Object.fromEntries(entries)
}

/** @param ms - delay in milliseconds. */
export function delay(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

/**
 * Run a command without a shell and capture bounded stdout/stderr.
 *
 * @param command - executable name or path.
 * @param args - arguments after the executable.
 * @param timeoutMs - budget before the command is killed and reported as timed out.
 */
export function runCommand(command: string, args: readonly string[], timeoutMs = 5000): Promise<CommandResult> {
  return new Promise(resolve => {
    const child = spawn(command, [...args], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined

    const finish = (result: CommandResult): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      resolve(result)
    }
    const append = (current: string, chunk: string): string => (current + chunk).slice(-COMMAND_OUTPUT_LIMIT)

    child.stdout?.setEncoding('utf8')
    child.stdout?.on('data', (chunk: string) => {
      stdout = append(stdout, chunk)
    })
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (chunk: string) => {
      stderr = append(stderr, chunk)
    })
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish({ code: null, stdout, stderr, missing: error.code === 'ENOENT', timedOut: false })
    })
    child.on('close', (code: number | null) => {
      finish({ code, stdout, stderr, missing: false, timedOut: false })
    })

    timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        // The command is already gone; the timeout result still stands.
      }
      finish({ code: null, stdout, stderr, missing: false, timedOut: true })
    }, timeoutMs)
  })
}

/** @param pid - process id to probe; `EPERM` still means the process exists. */
export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

/**
 * Wait until a PID disappears or the budget expires.
 *
 * @returns whether the process is gone when the wait ends.
 */
export async function waitForProcessExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) return true
    await delay(100)
  }
  return !isProcessAlive(pid)
}

/**
 * Terminate a spawned process tree. Windows uses `taskkill /T`; POSIX kills the
 * detached process group, falling back to the leader when no group exists.
 *
 * @param pid - process id of the spawned command.
 */
export async function terminateProcessTree(pid: number | undefined): Promise<void> {
  if (pid === undefined || pid <= 0) return
  if (process.platform === 'win32') {
    // The shell wrapper survives a plain kill; terminate the whole tree.
    await runCommand('taskkill', ['/pid', String(pid), '/T', '/F'], 15_000)
    return
  }
  signalGroup(pid, 'SIGTERM')
  if (await waitForProcessExit(pid, 3000)) return
  signalGroup(pid, 'SIGKILL')
  await waitForProcessExit(pid, 1000)
}

/** @param pid - process id or detached process-group id. @param signal - POSIX signal. */
function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal)
    return
  } catch {
    // No process group (not detached, or already gone); try the leader itself.
  }
  try {
    process.kill(pid, signal)
  } catch {
    // The leader is already gone; nothing left to terminate.
  }
}
