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

/** 启动监听；返回 stop（幂等）。启动即记录基线哈希，未变化的写入不触发回调。 */
/** Starts the watch; returns stop (idempotent). The baseline hash is recorded at start — writes without content change never fire. */
export function watchAuthFile(options: AuthFileWatchOptions): AuthFileWatch {
  let stopped = false
  let lastHash = hashFile(options.path)
  let debounce: ReturnType<typeof globalThis.setTimeout> | undefined
  let timeout: ReturnType<typeof globalThis.setTimeout> | undefined
  let watcher: FSWatcher | undefined
  let fallback: ReturnType<typeof globalThis.setInterval> | undefined

  const stop = (): void => {
    if (stopped) return
    stopped = true
    watcher?.close()
    if (debounce !== undefined) globalThis.clearTimeout(debounce)
    if (timeout !== undefined) globalThis.clearTimeout(timeout)
    if (fallback !== undefined) globalThis.clearInterval(fallback)
  }

  const onTick = (): void => {
    if (stopped) return
    globalThis.clearTimeout(debounce)
    debounce = globalThis.setTimeout(() => {
      if (stopped) return
      const hash = hashFile(options.path)
      if (hash === lastHash) return
      lastHash = hash
      options.onChange()
    }, options.debounceMs ?? 1_200)
  }

  try {
    watcher = watch(options.path, onTick)
  } catch {
    // 文件尚不存在：回退为存在性+哈希轮询（与 watch 同语义）。
    // The file does not exist yet: fall back to existence+hash polling (same semantics as watch).
    fallback = globalThis.setInterval(onTick, 2_000)
  }

  timeout = globalThis.setTimeout(() => stop(), options.timeoutMs)
  return { stop }
}

/** 本机 opencode CLI 登录产物的标准路径。The standard local opencode CLI artifact path. */
export const LOCAL_CLI_AUTH_JSON = join(homedir(), '.local', 'share', 'opencode', 'auth.json')
