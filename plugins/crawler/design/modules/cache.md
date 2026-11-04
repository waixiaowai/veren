---
title: 缓存
description: 带过期时间的键值缓存抽象与内存、外部服务双后端。
sidebar:
  order: 27
lastUpdated: 2026-11-04
---

缓存（外围域）：提供带过期时间的键值缓存抽象，内存与外部缓存服务双后端按配置切换；与消费方（代理池的 IP 缓存、手机号登录的验证码缓存）的分界是「消费方只面向抽象接口，后端选择归工厂」。

## 1. Responsibilities

- 抽象契约：取值、带过期时间写值、按模式匹配取键。
- 内存后端：进程内字典加过期时间戳，后台协程周期清理过期项。
- 外部后端：连接外部缓存服务，值经序列化存储，键枚举兼容集群部署。
- 工厂分发：按缓存类型配置创建后端，未知类型报错。

## 2. Contracts

```ts
type CacheType = "memory" | "redis";   // 配置常量，外部后端为 redis

abstract class AbstractCache {
  abstract get(key: string): Promise<unknown | null>;
  abstract set(key: string, value: unknown, expireTime: number): Promise<void>;
  abstract keys(pattern: string): Promise<string[]>;   // 支持 * 子串匹配
}

interface CacheFactoryContract {
  create(type: CacheType): AbstractCache;              // 未知类型抛错
}
```

## 3. Flow

内存后端的过期清理在后台协程完成，取值时也做即时过期判断，双保险保证不返回过期值。消费方示例：手机号登录把使用者回填的验证码写入缓存键，登录流程按手机号读取；代理池把拉取的 IP 信息写入缓存键（当前实现固定选择外部后端，部署外部缓存服务为代理池的前提）。

失败分支与恢复策略：外部后端连接失败在使用首键时暴露并由消费方处理；内存后端无外部依赖，进程退出即清空，不承诺跨进程持久。

## 4. Acceptance

1. **成功路径**：写入后立即读取返回原值，过期时间到达后读取返回空。
2. **切换路径**：两种后端在相同契约下行为一致，消费方代码无需修改。
3. **失败路径**：未知缓存类型在工厂创建时抛错，不产生半初始化实例。
4. **清理路径**：过期项在后台周期内被清理，内存占用不随时间无限增长。
