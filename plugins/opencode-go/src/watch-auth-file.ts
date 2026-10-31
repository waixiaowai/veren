/**
 * 本机 CLI 登录产物的监听器：文件变化（mtime/内容哈希）去抖后回调一次，
 * 超时自停。生命周期：点击登录（=用户授权）后启动，导入成功或超时即停，
 * 不常驻。文件缺失时回退为轮询存在性+哈希（Windows 首建目录 watch 会抛）。
 *
 * Watches the local CLI login artifact: file changes (mtime/content hash) are
 * debounced into one callback; the watch stops itself on success or timeout.
 * Lifecycle: started only by the user's sign-in click (= consent), stops after
 * import or timeout — never resident. A missing file falls back to polling
 * existence + hash (fs.watch throws on Windows for not-yet-created files).
 *
 * @module @veren/opencode-go/watch-auth-file
 */
import { homedir } from 'node:os'
import { join } from 'node:path'
import { watch, readFileSync, type FSWatcher } from 'node:fs'
import { createHash } from 'node:crypto'

export interface AuthFileWatchOptions {
  /** 监听的 auth.json 绝对路径。The absolute auth.json path to watch. */
  path: string
  /** 总超时：到点自停（不再回调）。Total timeout: stops itself, no callbacks after. */
  timeoutMs: number
  /** 变更去抖窗口（默认 1200ms）。The change debounce window (default 1200ms). */
  debounceMs?: number
  /** 文件内容确认变化后回调（每个去抖周期至多一次）。Fires at most once per debounce cycle after a confirmed content change. */
  onChange: () => void
}

export interface AuthFileWatch {
  /** 停止监听并清理定时器；幂等。Stops watching and clears timers; idempotent. */
  stop: () => void
}

/** 文件内容指纹：不可读回答 'missing'。Content fingerprint: unreadable answers 'missing'. */
function hashFile(path: string): string {
  try {
    return createHash('sha256').update(readFileSync(path)).digest('hex')
  } catch {
    return 'missing'
  }
}

/** 监听器的可变句柄状态。The watch's mutable handle state. */
interface WatchState {
  stopped: boolean
  lastHash: string
  debounce: ReturnType<typeof globalThis.setTimeout> | undefined
  timeout: ReturnType<typeof globalThis.setTimeout> | undefined
  watcher: FSWatcher | undefined
  fallback: ReturnType<typeof globalThis.setInterval> | undefined
}

/** 组合 stop：幂等，关 watcher 并清全部定时器。Composes stop: idempotent, closes the watcher and clears every timer. */
function createStop(state: WatchState): () => void {
  return () => {
    if (state.stopped) return
    state.stopped = true
    state.watcher?.close()
    if (state.debounce !== undefined) globalThis.clearTimeout(state.debounce)
    if (state.timeout !== undefined) globalThis.clearTimeout(state.timeout)
    if (state.fallback !== undefined) globalThis.clearInterval(state.fallback)
  }
}

/** 组合 onTick：变化去抖后回调一次。Composes onTick: debounces changes into one callback. */
function createOnTick(state: WatchState, options: AuthFileWatchOptions): () => void {
  return () => {
    if (state.stopped) return
    globalThis.clearTimeout(state.debounce)
    state.debounce = globalThis.setTimeout(() => {
      if (state.stopped) return
      const hash = hashFile(options.path)
      if (hash === state.lastHash) return
      state.lastHash = hash
      options.onChange()
    }, options.debounceMs ?? 1_200)
  }
}

/** 打开 fs.watch；error（EPERM）与文件缺失都降级为轮询。Opens fs.watch; both an error (EPERM) and a missing file degrade to polling. */
function openWatcher(state: WatchState, options: AuthFileWatchOptions, onTick: () => void): void {
  try {
    state.watcher = watch(options.path, onTick)
    // Windows 上被监视文件被重写/删除的瞬间 watch 会发 error（EPERM）；
    // EventEmitter 的 error 无监听=进程崩溃。降级为轮询而非吞掉。
    // On Windows, a rewritten/deleted watched file makes watch emit error
    // (EPERM); an unhandled EventEmitter error crashes the process — degrade
    // to polling instead of swallowing.
    state.watcher.on('error', () => {
      if (state.stopped) return
      state.watcher?.close()
      state.watcher = undefined
      if (state.fallback === undefined) state.fallback = globalThis.setInterval(onTick, 2_000)
    })
  } catch {
    // 文件尚不存在：回退为存在性+哈希轮询（与 watch 同语义）。
    // The file does not exist yet: fall back to existence+hash polling (same semantics as watch).
    state.fallback = globalThis.setInterval(onTick, 2_000)
  }
}

/** 启动监听；返回 stop（幂等）。启动即记录基线哈希，未变化的写入不触发回调。 */
/** Starts the watch; returns stop (idempotent). The baseline hash is recorded at start — writes without content change never fire. */
export function watchAuthFile(options: AuthFileWatchOptions): AuthFileWatch {
  const state: WatchState = {
    stopped: false,
    lastHash: hashFile(options.path),
    debounce: undefined,
    timeout: undefined,
    watcher: undefined,
    fallback: undefined,
  }
  const onTick = createOnTick(state, options)
  openWatcher(state, options, onTick)
  const stop = createStop(state)
  state.timeout = globalThis.setTimeout(stop, options.timeoutMs)
  return { stop }
}

/** 本机 opencode CLI 登录产物的标准路径。The standard local opencode CLI artifact path. */
export const LOCAL_CLI_AUTH_JSON = join(homedir(), '.local', 'share', 'opencode', 'auth.json')
