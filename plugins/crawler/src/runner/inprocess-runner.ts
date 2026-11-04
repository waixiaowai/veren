/**
 * 进程内运行器：采集在宿主进程内执行（存储域访问要求），日志走同一环形
 * 缓冲，状态语义与句柄抽象一致。
 * The in-process runner: crawls execute inside the host process (the
 * storage domain requires it); logs flow into the same ring buffer, status
 * semantics match the handle abstraction.
 *
 * 终止语义：进程内无强杀，只有协作式取消——在页间与条目间检查取消标记。
 * Termination semantics: no force-kill in-process, cooperative cancellation
 * only — checked between pages and items.
 *
 * @module @veren/crawler/runner/inprocess-runner
 */
import type { CrawlerRunRequest, RunnerHandle, RunnerSpawner } from '../control/runner.ts'
import type { LogBuffer } from '../control/logs.ts'
import type { CrawlerStore } from '../store/domain.ts'
import { runPipeline, type PipelineDeps } from '../pipeline.ts'

/** 取消标记：协作式终止的唯一通道 / the cancel flag: the only channel of cooperative termination */
export class CancelFlag {
  private cancelled = false

  /** 置位取消 / raise the flag */
  cancel(): void {
    this.cancelled = true
  }

  /** 是否已取消 / whether raised */
  get isCancelled(): boolean {
    return this.cancelled
  }
}

/** 进程内运行器构造参数 / in-process runner construction options */
export interface InProcessRunnerOptions {
  /** 管线依赖（按请求造）/ the pipeline dependencies (built per request) */
  deps: (request: CrawlerRunRequest) => PipelineDeps
  /** 已打开的宿主存储域（取数时求值）/ the opened host storage domain (evaluated at spawn) */
  domain: () => CrawlerStore
  /** 媒体文件根目录 / the media file root */
  mediaRoot?: string
}

/**
 * 进程内运行器工厂：启动请求在宿主进程内跑完整管线。
 * The in-process runner factory: a start request runs the full pipeline
 * inside the host process.
 */
export const createInProcessRunner =
  (options: InProcessRunnerOptions): RunnerSpawner =>
  (request: CrawlerRunRequest, logs: LogBuffer): RunnerHandle => {
    const flag = new CancelFlag()
    logs.append('[INFO] in-process crawl starting')
    const exit = runPipeline(request, options.deps(request), {
      domain: options.domain(),
      cancelFlag: flag,
      ...(options.mediaRoot === undefined ? {} : { mediaRoot: options.mediaRoot }),
    })
      .then((code) => {
        logs.append(`[INFO] in-process crawl finished with code ${code}`)
        return code
      })
      .catch((error: unknown) => {
        logs.append(`[ERROR] ${String(error)}`)
        return 1
      })
    return {
      exit,
      terminate: () => flag.cancel(),
      kill: () => flag.cancel(),
    }
  }
