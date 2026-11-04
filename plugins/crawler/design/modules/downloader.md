---
title: 媒体下载
description: 平台无关的图片视频落盘、断点续传与音视频合流。
sidebar:
  order: 25
  label: 媒体下载
lastUpdated: 2026-11-04
---

媒体下载（外围域）：把内容附带的图片与视频字节流统一落盘，处理断点续传、重试与音视频分轨合流；它不认识任何平台，与爬取器的分界是「爬取器解析出媒体地址列表后交出，下载失败不影响采集」。

## 1. Responsibilities

- 接收媒体项列表（地址、类型、归属内容 id、备用地址链），串行下载落盘。
- 下载策略：流式读取、断点续传（分片临时文件加续传范围请求）、指数退避重试、内容类型校验、大小校验、零字节文件视为损坏重下。
- 音视频分轨：B 站等平台音视频分离时下载两路分片后调用外部工具合流。
- 路径治理：文件名清洗为安全字符集、Windows 保留名处理、长度截断、目录穿越防护、扩展名白名单与推断优先级。

触发方式为显式调用：各平台爬取器在内容落库后按媒体开关调用下载；五平台接入（xhs、dy、ks、bili、wb），贴吧与知乎数据结构无媒体字段不接入。

## 2. Contracts

```ts
type MediaType = "image" | "video";

interface MediaItem {
  url: string;                  // 首选地址
  fallbackUrls: string[];       // 备用地址链，上限三个候选
  type: MediaType;
  contentId: string;            // 归属内容 id
  isDash: boolean;              // 音视频分轨标记
  audioUrl?: string;            // 分轨音频地址
}

interface MediaPathPolicy {     // 落盘规则
  root: string;                 // 数据根目录
  buildPath(item: MediaItem, extension: string): string;
  // {root}/{platform}/media/{contentId}/{stem}{extension}
}

abstract class MediaDownloaderContract {
  abstract downloadAll(items: MediaItem[]): Promise<DownloadReport>;
}

interface DownloadReport {
  succeeded: MediaItem[];
  failed: Array<{ item: MediaItem; reason: string }>;  // 失败只上报不抛出
}
```

落盘目录：`数据根/平台/media/内容ID/文件名`。扩展名白名单为常见图片与视频格式；推断优先级为显式指定、地址后缀、响应内容类型、默认值。

## 3. Flow

```ts
// 用途：表达下载主流程与失败分支
async function downloadAll(items: MediaItem[]): Promise<DownloadReport> {
  const report: DownloadReport = { succeeded: [], failed: [] };
  for (const item of items) {                       // 串行：跟随采集节奏，不抢带宽
    try {
      const path = pathPolicy.buildPath(item, inferExtension(item));
      guardWithin(path, pathPolicy.root);           // 目录穿越防护
      await downloadOne(item, path);                // 见下
      report.succeeded.push(item);
    } catch (err) {
      logWarn("[Media]", item.url, err);            // 旁路失败不中断采集
      report.failed.push({ item, reason: String(err) });
    }
  }
  return report;
}

async function downloadOne(item: MediaItem, path: string): Promise<void> {
  for (const url of [item.url, ...item.fallbackUrls]) {     // 备用地址链
    try {
      await fetchToPartFile(url, path);             // .part 临时文件 + 续传范围请求
      verifyContentTypeAndSize(path);               // 校验失败视为本次候选失败
      if (item.isDash) await mergeDash(path, item.audioUrl); // 合流为最终格式
      return;
    } catch (err) {
      await sleepBackoff(attempt);                  // 指数退避：基准延迟 × 2^次数，封顶
    }
  }
  throw new MediaDownloadError(item.contentId);
}
```

失败分支与恢复策略：单候选失败换下一候选；全部候选耗尽抛错并计入失败清单；已存在的完整文件跳过（续传语义），损坏文件删除重下；下载失败永不中断采集主流程。

## 4. Acceptance

1. **成功路径**：开启媒体开关后，内容附带的图片与视频按目录规则落盘，文件大小与来源一致。
2. **失败隔离**：单个媒体地址失效时，其余媒体正常落盘，采集不中断，日志含失败地址。
3. **续传路径**：中断后重跑，已完整下载的文件跳过，损坏的临时文件被删除重下。
4. **安全路径**：构造含目录穿越字符的文件名时，落盘路径被约束在数据根目录内；保留名与超长名被清洗。
5. **合流路径**：分轨视频在两路分片完整后合流为最终格式，合流失败计入失败清单。
