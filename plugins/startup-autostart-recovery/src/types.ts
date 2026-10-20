/**
 * Recovery vocabulary: the shapes shared by the marker, the crash-cause
 * lookup, the OS autostart writer, and the plugin service.
 *
 * 恢复词汇表：落盘标记、崩溃原因查找、操作系统自启动写入器与插件服务共享的形状。
 * @module @veren/startup-autostart-recovery/types
 */

/**
 * Why the previous process is believed to have exited. The wording is what the
 * recovery prompt quotes verbatim, so it must stay honest: when no crash log
 * proves a cause, the detail says exactly that instead of inventing one.
 */
export interface CrashCause {
  /** Whether a crash log plausibly from the previous run was found. */
  readonly found: boolean
  /** File name of that crash log, inside the crash-log directory. */
  readonly logFile?: string
  /** The cause text the recovery prompt quotes; never a guess. */
  readonly detail: string
}

/** The last session the plugin saw active, persisted for crash recovery. */
export interface LastActiveSession {
  /** Session id, as the Agent registry addresses it. */
  readonly sessionId: string
  /** Instant the session was recorded, ISO 8601. */
  readonly at: string
}

/** What one boot concluded about the previous shutdown, and what it did. */
export interface RecoveryStatus {
  /** Whether the previous exit lacked the graceful-shutdown marker. */
  readonly unclean: boolean
  /** The cause as far as it could be established honestly. */
  readonly cause: CrashCause
  /** The recorded last active session, when one existed. */
  readonly lastSession?: LastActiveSession
  /** Whether the recovery prompt was delivered this boot. */
  readonly delivered: boolean
  /** One-line account of what the boot did, for logs and the service surface. */
  readonly detail: string
}

/** Observable state of the Windows logon-autostart entry. */
export interface AutostartStatus {
  /** Whether this platform has an implementation at all. */
  readonly platformSupported: boolean
  /** Whether the entry file currently exists. */
  readonly enabled: boolean
  /** Full path of the entry file, present even when the entry is off. */
  readonly entryPath: string
}

/** One boot's liveness flag, as it is stored on disk. */
export interface BootFlag {
  /** Unique id of the boot that wrote the flag. */
  readonly bootId: string
  /** Instant the boot started, ISO 8601. */
  readonly startedAt: string
}

/** What claiming the boot flag found there before the claim. */
export interface BootClaim {
  /** A previous flag was still present, so the previous exit was not graceful. */
  readonly unclean: boolean
  /** The previous flag's content, when it could be parsed. */
  readonly previous?: BootFlag
}
