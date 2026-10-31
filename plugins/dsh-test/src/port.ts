/**
 * Target-port pre-check for the managed web instance: find the process listening
 * on the configured port, stop only that listener (Windows `taskkill`, POSIX
 * signals), and wait until the socket is released before the CLI binds it.
 */
import { createServer } from 'node:net'
import { delay, errorMessage, runCommand, waitForProcessExit } from './process.js'
import type { DshTestConfig } from './types.js'

/** Budget for one OS listener query (`netstat`, `lsof`, `ss`). */
const QUERY_TIMEOUT_MS = 10_000
/** Budget for the killed listener to release its socket. */
const PORT_RELEASE_TIMEOUT_MS = 10_000
/** Poll interval while waiting for the released socket. */
const PORT_RELEASE_POLL_MS = 150

/** How a port probe on this host ended. */
type PortProbe = 'free' | 'in-use' | 'unavailable'

/** Listeners found on one port; `queried` is false when no OS tool could answer. */
interface ListenerQuery {
  readonly pids: readonly number[]
  readonly queried: boolean
}

/**
 * Resolve the port this launch will actually use. An explicit `port` config wins;
 * otherwise a `--port N` / `--port=N` pair inside `args` is used. Without either,
 * the CLI picks a port and no pre-check target exists.
 *
 * @param config - validated plugin configuration.
 */
export function resolveTargetPort(config: DshTestConfig): number | undefined {
  if (config.port !== undefined) return config.port
  for (let index = 0; index < config.args.length; index += 1) {
    const arg = config.args[index]
    if (arg === undefined) continue
    if (arg === '--port') {
      const value = config.args[index + 1]
      if (value !== undefined && isPortNumber(value)) return Number(value)
    } else if (arg.startsWith('--port=')) {
      const value = arg.slice('--port='.length)
      if (isPortNumber(value)) return Number(value)
    }
  }
  return undefined
}

/**
 * Build the launch arguments. An explicit `port` config replaces any `--port`
 * pair already present in `args`, so the checked port and the bound port cannot
 * drift apart; without it the arguments pass through unchanged.
 *
 * @param config - validated plugin configuration.
 */
export function buildLaunchArgs(config: DshTestConfig): string[] {
  if (config.port === undefined) return [...config.args]
  const args: string[] = []
  for (let index = 0; index < config.args.length; index += 1) {
    const arg = config.args[index]
    if (arg === undefined) continue
    if (arg === '--port') {
      index += 1
      continue
    }
    if (arg.startsWith('--port=')) continue
    args.push(arg)
  }
  args.push('--port', String(config.port))
  return args
}

/**
 * Make the target port ready for the CLI. A no-op when no target port is known.
 *
 * @param port - target port, or undefined when the CLI picks one itself.
 */
export async function preparePort(port: number | undefined): Promise<void> {
  if (port === undefined) return
  const owners = await queryListeners(port)
  if (owners.pids.length === 0) {
    // Windows netstat is authoritative. On POSIX lsof can hide another user's
    // listener, so confirm with a bind probe before declaring the port free.
    // Windows 上 netstat 是权威的；POSIX 的 lsof 可能看不到其他用户的监听，
    // 所以在宣布端口空闲前先用绑定探测确认。
    if (owners.queried && process.platform === 'win32') return
    const probe = await probePort(port)
    if (probe !== 'in-use') return
    throw new Error(unidentifiedOwnerMessage(port))
  }
  throwIfProtectedOwner(port, owners)
  await stopListeners(port, owners)
  await waitForRelease(port, owners)
}

/**
 * Refuse a target port held by a Windows system process or by this host
 * process itself — stopping either would break the machine or the harness.
 *
 * @param port - target port being freed.
 * @param owners - listeners found on the port.
 */
function throwIfProtectedOwner(port: number, owners: ListenerQuery): void {
  if (process.platform === 'win32' && owners.pids.some(pid => pid === 0 || pid === 4)) {
    throw new Error(`port ${port} is held by a Windows system process; refusing to stop it`)
  }
  if (owners.pids.includes(process.pid)) {
    throw new Error(`port ${port} is held by the current dsh-test host process (pid ${process.pid}); refusing to kill itself`)
  }
}

/**
 * Stop every identified listener; one failure is collected so the others still
 * get their chance, then the whole operation fails with the summary.
 *
 * @param port - target port being freed.
 * @param owners - listeners found on the port.
 */
async function stopListeners(port: number, owners: ListenerQuery): Promise<void> {
  const failures: string[] = []
  for (const pid of owners.pids) {
    try {
      await killListener(pid)
    } catch (cause) {
      failures.push(`pid ${pid}: ${errorMessage(cause)}`)
    }
  }
  if (failures.length > 0) {
    throw new Error(`port ${port} is in use, but stopping its listener failed (${failures.join('; ')})`)
  }
}

/**
 * Wait until the killed listeners have actually released the socket, polling
 * the authoritative query first and falling back to the bind probe.
 *
 * @param port - target port being freed.
 * @param owners - listeners that were stopped.
 */
async function waitForRelease(port: number, owners: ListenerQuery): Promise<void> {
  const deadline = Date.now() + PORT_RELEASE_TIMEOUT_MS
  while (Date.now() < deadline) {
    const remaining = await queryListeners(port)
    if (remaining.queried && remaining.pids.length === 0) return
    if (!remaining.queried && (await probePort(port)) !== 'in-use') return
    await delay(PORT_RELEASE_POLL_MS)
  }
  throw new Error(
    `port ${port} is still in use after stopping process ${owners.pids.join(', ')};`
    + ' another process may have taken it',
  )
}

/** @param value - candidate CLI port token. */
function isPortNumber(value: string): boolean {
  const port = Number(value)
  return Number.isInteger(port) && port >= 1 && port <= 65535 && String(port) === value
}

/**
 * List the PIDs listening on one TCP port via the platform's own tool.
 *
 * @param port - TCP port to inspect.
 */
async function queryListeners(port: number): Promise<ListenerQuery> {
  if (process.platform === 'win32') {
    const result = await runCommand('netstat', ['-ano'], QUERY_TIMEOUT_MS)
    if (result.missing || result.timedOut) return { pids: [], queried: false }
    return { pids: parseWindowsNetstat(result.stdout, port), queried: true }
  }

  const lsof = await runCommand('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], QUERY_TIMEOUT_MS)
  if (!lsof.missing && !lsof.timedOut && !/permission denied/iu.test(lsof.stderr)) {
    return { pids: parsePidLines(lsof.stdout), queried: true }
  }

  const ss = await runCommand('ss', ['-ltnp'], QUERY_TIMEOUT_MS)
  if (!ss.missing && !ss.timedOut) return { pids: parseSs(ss.stdout, port), queried: true }
  return { pids: [], queried: false }
}

/**
 * Parse `netstat -ano` rows, keeping only LISTENING rows whose local port matches.
 *
 * @param output - raw netstat stdout.
 * @param port - TCP port to keep.
 */
function parseWindowsNetstat(output: string, port: number): number[] {
  const pids = new Set<number>()
  for (const line of output.split(/\r?\n/u)) {
    const fields = line.trim().split(/\s+/u)
    if (fields.length < 5 || fields[0] !== 'TCP' || fields[3] !== 'LISTENING') continue
    if (portOf(fields[1]) !== port) continue
    const pid = Number(fields[4])
    if (Number.isInteger(pid) && pid >= 0) pids.add(pid)
  }
  return [...pids].sort((left, right) => left - right)
}

/**
 * Parse `ss -ltnp` rows, keeping only LISTEN rows for the requested local port.
 * The process list (`pid=...`) may be absent for sockets owned by another user.
 *
 * @param output - raw ss stdout.
 * @param port - TCP port to keep.
 */
function parseSs(output: string, port: number): number[] {
  const pids = new Set<number>()
  for (const line of output.split(/\r?\n/u)) {
    const fields = line.trim().split(/\s+/u)
    if (fields[0] !== 'LISTEN' || portOf(fields[3]) !== port) continue
    for (const match of line.matchAll(/\bpid=(\d+)\b/gu)) pids.add(Number(match[1]))
  }
  return [...pids].sort((left, right) => left - right)
}

/** @param output - one PID per line, as printed by `lsof -t`. */
function parsePidLines(output: string): number[] {
  const pids = new Set<number>()
  for (const line of output.split(/\r?\n/u)) {
    const pid = Number(line.trim())
    if (Number.isInteger(pid) && pid > 0) pids.add(pid)
  }
  return [...pids].sort((left, right) => left - right)
}

/** @param address - `netstat`/`ss` local-address field such as `[::]:3210`. */
function portOf(address: string | undefined): number | undefined {
  if (address === undefined) return undefined
  const separator = address.lastIndexOf(':')
  if (separator < 0) return undefined
  const port = Number(address.slice(separator + 1))
  return Number.isInteger(port) && port > 0 ? port : undefined
}

/**
 * Probe whether this process can bind the port. Used only when the listener list
 * cannot answer; `unavailable` means the bind itself is unsupported (for example
 * IPv6 disabled), not that the port is occupied.
 *
 * @param port - TCP port to probe.
 */
function probePort(port: number): Promise<PortProbe> {
  return new Promise(resolve => {
    const server = createServer()
    server.unref()
    server.once('error', (error: NodeJS.ErrnoException) => {
      resolve(error.code === 'EADDRINUSE' ? 'in-use' : 'unavailable')
    })
    server.listen({ port, host: '0.0.0.0', exclusive: true }, () => {
      server.close(() => resolve('free'))
    })
  })
}

/**
 * Stop exactly the process listening on the target port: `taskkill /T` on
 * Windows, SIGTERM then SIGKILL (no process group) on POSIX.
 *
 * @param pid - listener process id.
 */
async function killListener(pid: number): Promise<void> {
  if (process.platform === 'win32') {
    const result = await runCommand('taskkill', ['/pid', String(pid), '/T', '/F'], 15_000)
    if (result.missing) throw new Error('taskkill is unavailable')
    return
  }
  try {
    process.kill(pid, 'SIGTERM')
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ESRCH') return
    throw cause
  }
  if (await waitForProcessExit(pid, 3000)) return
  try {
    process.kill(pid, 'SIGKILL')
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') throw cause
  }
  if (!(await waitForProcessExit(pid, 1000))) throw new Error('process did not exit after SIGKILL')
}

/** @param port - target port whose owner could not be identified. */
function unidentifiedOwnerMessage(port: number): string {
  return `port ${port} is in use, but no listening process could be identified`
    + ' (netstat/lsof/ss unavailable or permission denied); refusing to start'
}
