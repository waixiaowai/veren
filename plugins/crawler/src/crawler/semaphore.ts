/**
 * 并发信号量：详情与评论任务的并发度全部由同一配置控制
 * （design/modules/crawler.md 关键决策 3，默认 1）。
 * The concurrency semaphore: detail and comment task concurrency are both
 * governed by the one configuration (crawler.md decision 3, default 1).
 *
 * 违反后果是并发失控直接触发平台限频，因此一切并发任务必须经过这里。
 * Unbounded concurrency trips platform rate limits, so every concurrent
 * crawl task must pass through here.
 *
 * @module @veren/crawler/crawler/semaphore
 */

/** 计数信号量 / a counting semaphore */
export class Semaphore {
  private running = 0
  private readonly queue: Array<() => void> = []

  constructor(private readonly limit: number) {}

  /**
   * 在信号量约束下运行任务；超出并发的任务排队等待。
   * Runs the task under the semaphore; tasks beyond the limit queue up.
   */
  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await task()
    } finally {
      this.release()
    }
  }

  /** 取得一个许可 / acquire one permit */
  private acquire(): Promise<void> {
    if (this.running < this.limit) {
      this.running += 1
      return Promise.resolve()
    }
    return new Promise((resolve) => {
      this.queue.push(() => {
        this.running += 1
        resolve()
      })
    })
  }

  /** 释放许可并唤醒队首 / release the permit and wake the queue head */
  private release(): void {
    const next = this.queue.shift()
    if (next !== undefined) {
      next()
      return
    }
    this.running -= 1
  }
}
