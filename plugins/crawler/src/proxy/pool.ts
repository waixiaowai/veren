/**
 * 代理 IP 池：随机抽取并移出、池空重载、拉取重试三次、单活跃到期切换
 * （design/modules/proxy.md §2）。
 * The proxy IP pool: random draw and removal, reload on empty, three fetch
 * retries, and single-active expiry switching (design proxy.md §2).
 *
 * @module @veren/crawler/proxy/pool
 */
import { CrawlerError } from '../errors.ts'
import { isExpired, EXPIRY_BUFFER_SECONDS, type IpInfo } from './ip-info.ts'

/** 服务商接入契约 / the provider contract */
export type ProxyProvider = (count: number) => Promise<IpInfo[]>

/** 池构造参数 / pool construction options */
export interface ProxyPoolOptions {
  /** 服务商拉取接口 / the provider fetch interface */
  provider: ProxyProvider
  /** 池容量 / the pool capacity */
  capacity: number
  /** 拉取失败重试次数（设计固定三次）/ fetch retries (design-fixed at three) */
  maxRetries?: number
  /** 当前时刻（测试注入）/ the current instant (injected in tests) */
  nowTs?: () => number
}

/** 拉取耗尽错误 / the fetch-exhausted error */
function proxyFetchFailed(): CrawlerError {
  return new CrawlerError('PROXY_FETCH_FAILED', '代理获取失败，请检查代理配置', {})
}

/**
 * 单活跃代理池：维护一个当前代理与一个备用池。
 * The single-active proxy pool: one current proxy plus a spare pool.
 */
export class ProxyIpPool {
  private pool: IpInfo[] = []
  private current: IpInfo | null = null
  private readonly nowTs: () => number

  constructor(private readonly options: ProxyPoolOptions) {
    this.nowTs = options.nowTs ?? (() => Math.floor(Date.now() / 1000))
  }

  /** 随机抽取并移出池；池空自动重载；失败重试三次（验收 §2）/ random draw and removal; auto-reload on empty; three retries */
  async getProxy(): Promise<IpInfo> {
    for (let attempt = 0; attempt < (this.options.maxRetries ?? 3); attempt += 1) {
      try {
        if (this.pool.length === 0) await this.reload()
        const picked = this.pool.splice(this.randomIndex(), 1)[0]
        if (picked === undefined) throw proxyFetchFailed()
        return picked
      } catch {
        // 重试窗口内吞掉单次失败，耗尽后统一上抛 / swallow within the retry window, raise once exhausted
      }
    }
    // 设计失败分支：重试耗尽统一以 PROXY_FETCH_FAILED 上抛（errors.md）。
    // Design failure branch: retries exhausted raise PROXY_FETCH_FAILED
    // (errors.md).
    throw proxyFetchFailed()
  }

  /** 当前代理是否即将到期（含缓冲窗口）/ whether the current proxy is about to expire (with buffer) */
  isCurrentProxyExpired(bufferSeconds: number = EXPIRY_BUFFER_SECONDS): boolean {
    if (this.current === null) return true
    return isExpired(this.current, bufferSeconds, this.nowTs())
  }

  /** 到期自动更换：换上的新代理成为当前活跃代理 / expiry auto-switch: the fetched proxy becomes the active one */
  async getOrRefreshProxy(bufferSeconds: number = EXPIRY_BUFFER_SECONDS): Promise<IpInfo> {
    if (this.current === null || this.isCurrentProxyExpired(bufferSeconds)) {
      this.current = await this.getProxy()
    }
    return this.current
  }

  /** 当前活跃代理（无则 null）/ the active proxy (null when none) */
  activeProxy(): IpInfo | null {
    return this.current
  }

  /** 重载 IP 池 / reload the pool */
  private async reload(): Promise<void> {
    const fetched = await this.options.provider(this.options.capacity)
    if (fetched.length === 0) throw proxyFetchFailed()
    this.pool = fetched
  }

  /** 随机下标 / a random index */
  private randomIndex(): number {
    return Math.floor(Math.random() * this.pool.length)
  }
}
