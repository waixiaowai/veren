/**
 * 日志环形缓冲：最近五百条，含历史查询与实时订阅（design/modules/api.md §2）。
 * The log ring buffer: the last 500 entries with history queries and live
 * subscription (design api.md §2).
 *
 * @module @veren/crawler/control/logs
 */

/** 单条日志（级别由行前缀解析）/ one log entry (level parsed from the line prefix) */
export interface LogEntry {
  id: number
  timestamp: string
  level: 'INFO' | 'WARNING' | 'ERROR'
  message: string
}

/** 缓冲容量（design 固定值）/ the buffer capacity (design-fixed value) */
export const LOG_BUFFER_CAPACITY = 500

/** 行前缀 → 级别解析；未识别前缀按 INFO / line prefix → level; unknown prefixes are INFO */
function parseLevel(line: string): LogEntry['level'] {
  if (line.startsWith('[ERROR]') || line.startsWith('ERROR')) return 'ERROR'
  if (line.startsWith('[WARNING]') || line.startsWith('WARNING') || line.startsWith('[WARN]')) return 'WARNING'
  return 'INFO'
}

/** 去掉级别前缀的正文 / the message body without the level prefix */
function stripPrefix(line: string): string {
  return line.replace(/^\[(?:ERROR|WARNING|WARN|INFO)\]\s*/, '')
}

/**
 * 环形日志缓冲：溢出丢弃最旧条目，订阅者按推送收到新条目。
 * The ring log buffer: overflow drops the oldest entries; subscribers
 * receive new entries as pushed.
 */
export class LogBuffer {
  private readonly entries: LogEntry[] = []
  private nextId = 1
  private readonly subscribers = new Set<(entry: LogEntry) => void>()

  /** 追加一行日志并通知订阅者 / append one log line and notify subscribers */
  append(line: string, now: () => Date = () => new Date()): LogEntry {
    const entry: LogEntry = {
      id: this.nextId,
      timestamp: now().toISOString(),
      level: parseLevel(line),
      message: stripPrefix(line),
    }
    this.nextId += 1
    this.entries.push(entry)
    if (this.entries.length > LOG_BUFFER_CAPACITY) this.entries.shift()
    for (const notify of this.subscribers) notify(entry)
    return entry
  }

  /** 历史查询：按时间升序，limit 默认 100 上限为缓冲容量 / history: ascending, default 100 capped at capacity */
  recent(limit: number = 100): LogEntry[] {
    const bounded = Math.min(Math.max(limit, 1), LOG_BUFFER_CAPACITY)
    return this.entries.slice(-bounded)
  }

  /** 订阅实时日志；返回退订函数 / subscribe to live logs; returns the unsubscribe function */
  subscribe(notify: (entry: LogEntry) => void): () => void {
    this.subscribers.add(notify)
    return () => {
      this.subscribers.delete(notify)
    }
  }
}
