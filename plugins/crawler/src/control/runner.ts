/**
 * 运行句柄抽象：控制服务与采集执行（进程内运行器）的唯一耦合面。
 * The runner-handle abstraction: the only coupling surface between the
 * control service and the crawl execution (the in-process runner).
 *
 * @module @veren/crawler/control/runner
 */
import type { CrawlerType, Platform, LoginType } from '../types.ts'
import type { LogBuffer } from './logs.ts'

/** 启动请求 / the start request */
export interface CrawlerRunRequest {
  platform: Platform
  loginType: LoginType
  crawlerType: CrawlerType
  keywords: string[]
  specifiedIds: string[]
  creatorIds: string[]
  enableComments: boolean
  enableSubComments: boolean
  enableMedia: boolean
  cookies: string | null
  headless: boolean
  maxNotesCount: number
  maxCommentsCount: number
  startPage: number
}

/** 子进程句柄：日志回吐 + 退出承诺 + 终止/强杀 / the subprocess handle: log pump, exit promise, terminate/kill */
export interface RunnerHandle {
  /** 进程退出码承诺 / the promise of the exit code */
  readonly exit: Promise<number>
  /** 优雅终止信号 / the graceful terminate signal */
  terminate(): void
  /** 强制结束 / the forced kill */
  kill(): void
}

/** 句柄工厂：由启动请求拉起采集进程并把 stdout 泵进日志缓冲 / the handle factory: spawns the crawl process and pumps stdout into the log buffer */
export type RunnerSpawner = (req: CrawlerRunRequest, logs: LogBuffer) => RunnerHandle
