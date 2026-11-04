---
title: 启动器
description: 命令行解析、配置覆写、爬取器工厂与进程生命周期管理。
sidebar:
  order: 21
  label: 启动器
lastUpdated: 2026-11-04
---

启动器（外围域）：负责解析命令行参数、覆写全局配置、按平台标识创建对应爬取器并管理采集进程从启动到清理的完整生命周期；它不执行任何采集逻辑，与平台爬取器的分界是「创建与收尾归启动器，采集归爬取器」。

## 1. Responsibilities

- 解析命令行参数并校验枚举合法性，非法值告警后回退默认，不中断进程。
- 把命令行参数覆写到全局配置，命令行优先级高于配置文件。
- 在数据库类保存模式下于采集前自动初始化表结构，避免首跑建表缺失。
- 通过爬取器工厂按平台标识分发到对应实现，未知平台直接报错。
- 采集结束后按保存介质执行收尾（Excel 落盘、词云生成），并统一执行浏览器与连接的清理。
- 响应中断信号：首次中断触发限时优雅清理，二次中断强制退出。

## 2. Contracts

```ts
// 平台标识，与爬取器工厂的键一一对应
type Platform = "xhs" | "dy" | "ks" | "bili" | "wb" | "tieba" | "zhihu";
// 采集模式
type CrawlerType = "search" | "detail" | "creator";
// 登录方式
type LoginType = "qrcode" | "phone" | "cookie";
// 数据保存介质
type SaveDataOption = "csv" | "db" | "json" | "jsonl" | "sqlite" | "mongodb" | "excel" | "postgres";
// 数据库初始化选项
type InitDbOption = "sqlite" | "mysql" | "postgres";

interface CommandArgs {
  platform: Platform;
  loginType: LoginType;
  crawlerType: CrawlerType;
  keywords: string[];            // search 模式关键词
  specifiedId: string[];         // detail 模式目标 ID 列表
  creatorId: string[];           // creator 模式创作者标识列表
  startPage: number;             // 起始页码
  getComment: boolean;           // 是否抓取一级评论
  getSubComment: boolean;        // 是否抓取二级评论
  getMedia: boolean;             // 是否下载媒体文件
  saveDataOption: SaveDataOption;
  cookies: string | null;        // cookie 登录方式的凭证串
  headless: boolean;
  crawlerMaxNotesCount: number;  // 内容数量上限
  maxCommentsCountSingleNotes: number; // 单条内容评论上限
  maxConcurrencyNum: number;     // 并发信号量
  initDb: InitDbOption | null;   // 仅初始化库后退出
  saveDataPath: string;          // 数据输出根目录
  enableIpProxy: boolean;
  ipProxyPoolCount: number;
  ipProxyProviderName: "kuaidaili" | "wandouhttp" | "static";
  staticProxyUrl: string | null;
}

interface CrawlerCommand {
  start(): Promise<void>;
}

abstract class CrawlerFactoryContract {
  // 平台标识 → 爬取器实现；未注册的平台抛出参数错误
  abstract create(platform: Platform): CrawlerCommand;
}
```

## 3. Flow

入口函数先解析参数，再按「建库 → 建爬取器 → 采集 → 收尾」推进；伪代码展示失败分支与清理顺序。

```ts
// 用途：表达命令行入口的业务流程与异常路径
async function main(argv: string[]): Promise<number> {
  const args: CommandArgs = parseCmd(argv);          // 非法枚举告警回退默认
  if (args.initDb !== null) {
    await db.initDb(args.initDb);                    // 仅建库即退出
    return 0;
  }
  if (needsSchema(args.saveDataOption)) {
    await db.initDb(args.saveDataOption);            // 库类介质先自动建表
  }
  let crawler: CrawlerCommand | null = null;
  try {
    crawler = crawlerFactory.create(args.platform);  // 未知平台抛 InvalidPlatformError
    await crawler.start();                           // 采集主体，失败向上抛
    flushExcelIfNeeded(args.saveDataOption);         // Excel 模式全量驻内存，收尾才落盘
    await generateWordcloudIfNeeded(args);           // json/jsonl + 词云开关
    return 0;
  } catch (err) {
    logError("[Main]", err);
    return 1;
  } finally {
    await cleanupCrawler(crawler);                   // 浏览器上下文 / CDP 连接 / 数据库连接
  }
}
```

失败分支与恢复策略：

- **未知平台**：工厂查表失败立即抛错并列出全部合法值，进程以参数错误退出，不进入采集。
- **非法枚举参数**：解析层告警并回退默认值，进程继续——意图是让自动化脚本不因小笔误中断。
- **采集异常**：`finally` 强制清理浏览器上下文与数据库连接，清理动作各自吞掉「连接已关闭」类预期异常，其余异常记日志。
- **中断信号**：首次 SIGINT/SIGTERM 取消主任务并限时（15 秒）执行清理，超时后取消剩余任务；二次中断跳过一切清理立即退出（退出码 130）；CDP 接管模式下首次中断额外强制清理浏览器启动器。

## 4. Acceptance

1. **成功路径**：给定合法平台与搜索关键词，进程完成采集并以退出码 0 结束；使用 Excel 介质时数据文件在收尾阶段出现。
2. **拒绝路径**：传入未注册的平台标识，进程在创建爬取器前退出，错误信息列出全部合法平台值，不产生任何数据文件。
3. **失败恢复**：采集过程中目标平台不可达导致异常退出时，进程仍完成浏览器与连接清理，无残留浏览器进程；退出码为 1。
4. **中断恢复**：采集中按一次 Ctrl+C，进程在限时内退出且无残留子进程；再次 Ctrl+C 立即退出（退出码 130）。
5. **幂等路径**：仅初始化数据库的命令重复执行不报错，表结构幂等创建。
