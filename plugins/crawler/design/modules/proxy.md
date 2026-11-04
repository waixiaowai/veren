---
title: 代理池
description: 代理服务商接入、IP 池管理、到期切换与请求前刷新。
sidebar:
  order: 26
  label: 代理池
lastUpdated: 2026-11-04
---

代理池（外围域）：从代理服务商拉取出口 IP，维护一个单活跃代理池并在到期时自动切换；与爬取器的分界是「爬取器每次请求前调用刷新钩子，IP 的获取、验活与缓存归本模块」。

## 1. Responsibilities

- 服务商接入：按配置选择代理服务商（快代理、豌豆 HTTP、静态代理三种），统一拉取接口。
- IP 池管理：按池容量拉取、可选验活、随机抽取并在池空时重载。
- 到期管理：单活跃代理模式，到期前缓冲窗口内自动更换。
- IP 缓存：拉取结果写入缓存服务（固定使用外部缓存后端），跨进程复用。
- 请求前刷新：以混入钩子形式提供给各平台接口客户端，每次请求前检查并切换。

## 2. Contracts

```ts
type ProxyProviderName = "kuaidaili" | "wandouhttp" | "static";

interface IpInfo {
  ip: string;
  port: number;
  protocol: string;             // 默认 https
  user: string | null;
  password: string | null;
  expiredTimeTs: number | null;
  isExpired(bufferSeconds?: number): boolean;   // 到期缓冲默认 30 秒
}

abstract class ProxyProviderContract {
  abstract getProxy(count: number): Promise<IpInfo[]>;
}

interface ProxyIpPoolContract {
  getProxy(): Promise<IpInfo>;            // 随机抽取并移出池；拉取失败重试三次
  isCurrentProxyExpired(bufferSeconds?: number): boolean;
  getOrRefreshProxy(bufferSeconds?: number): Promise<IpInfo>;  // 到期自动更换
}

// 混入钩子：各平台客户端在每次请求前调用
interface ProxyRefreshMixinContract {
  initProxyPool(pool: ProxyIpPoolContract): void;
  refreshProxyIfExpired(): Promise<void>;
}
```

格式转换统一收口：浏览器自动化代理使用「ip:port」形态，内部请求客户端代理使用完整 URL 形态，由工具函数按消费方转换。

## 3. Flow

```ts
// 用途：表达请求前刷新与失败分支
async function refreshProxyIfExpired(): Promise<void> {
  if (!config.enableIpProxy) return;              // 开关关闭直通
  if (!pool.isCurrentProxyExpired(BUFFER_SECONDS)) return;
  try {
    const next = await pool.getOrRefreshProxy();  // 池空自动重载；拉取失败重试三次
    rebuildProxyClients(next);                    // 重建浏览器与请求客户端的代理配置
  } catch (err) {
    logWarn("[Proxy]", err);                      // 刷新失败保留当前代理继续请求
  }
}
```

失败分支与恢复策略：拉取失败按固定间隔重试三次后上抛，由调用方决定是否继续使用旧代理；验活开关开启时，不可达 IP 不入池；静态代理跳过验活且视为永不过期。

## 4. Acceptance

1. **成功路径**：开关开启时采集请求经代理出口发出，日志可见当前代理信息。
2. **切换路径**：当前代理到期后下一次请求前自动更换，采集不中断。
3. **失败路径**：服务商不可用时拉取重试三次后告警，采集在旧代理上继续或按配置终止，不出现无代理裸奔。
4. **关闭路径**：开关关闭时全部刷新钩子直通，不产生任何代理调用。
