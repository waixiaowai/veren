---
title: 控制服务
description: 以子进程包装命令行入口，向控制台面板提供启停、状态、日志与数据服务。
sidebar:
  order: 29
  label: 控制服务
lastUpdated: 2026-11-04
---

控制服务（外围域）：以子进程方式包装命令行入口，向控制台面板提供任务启停、状态查询、日志流与数据文件服务；它不导入爬虫内核代码，与采集进程的唯一耦合是命令行参数约定，因此内核任何变更不影响本模块的进程模型。

## 1. Responsibilities

- 任务管理：全局单任务管理器，接收启动请求后拼装命令行参数、以子进程拉起采集进程；运行中重复启动被拒绝；停止请求以终止信号加超时强杀实现。
- 日志通道：逐行读取子进程标准输出，解析日志级别，写入内存环形缓冲并提供历史查询与实时推送。
- 状态推进：进程运行状态机（空闲、启动中、运行中、停止中、异常），每秒向面板推送。
- 数据服务：扫描数据根目录下的数据文件，提供列表、预览、下载与统计。
- 环境检查：执行一次入口命令的帮助输出来验证运行环境可用。
- 静态托管：托管控制台面板构建产物，生产形态单端口访问。

## 2. Contracts

```ts
// 任务管理器（进程内单例）
interface CrawlerManagerContract {
  start(req: CrawlerStartRequest): Promise<{ status: "started" | "rejected"; message: string }>;
  stop(): Promise<{ status: "stopped" | "not_running"; message: string }>;
  status(): CrawlerStatus;
}

interface CrawlerStartRequest {
  platform: Platform; loginType: LoginType; crawlerType: CrawlerType;
  keywords: string[]; specifiedIds: string[]; creatorIds: string[];
  enableComments: boolean; enableSubComments: boolean; enableMedia: boolean;
  saveOption: SaveDataOption; cookies: string | null; headless: boolean;
  maxNotesCount: number; maxCommentsCount: number; startPage: number;
}

type CrawlerRunStatus = "idle" | "starting" | "running" | "stopping" | "error";
interface CrawlerStatus {
  status: CrawlerRunStatus;
  platform: Platform | null;
  crawlerType: CrawlerType | null;
  startedAt: string | null;
  errorMessage: string | null;
}

interface LogEntry { id: number; timestamp: string; level: "INFO" | "WARNING" | "ERROR"; message: string; }
```

日志缓冲保留最近五百条；停止流程先发终止信号并限时等待，超时后强制结束进程。

## 3. Flow

```ts
// 用途：表达启停流程与互斥约束
async function start(req: CrawlerStartRequest): Promise<StartResult> {
  if (manager.status().status === "running" || manager.status().status === "starting") {
    return { status: "rejected", message: "已有采集任务在运行" };   // 单任务互斥
  }
  const cmd = buildCommand(req);          // 参数与命令行入口一一对应
  manager.proc = spawn(cmd);              // 以子进程运行采集入口
  manager.markStarting(req);
  pumpStdoutToBuffer(manager.proc);       // 逐行解析日志级别入缓冲与推送队列
  watchExit(manager.proc);                // 退出码非零置 error 态
  return { status: "started", message: "已启动" };
}

async function stop(): Promise<StopResult> {
  if (!manager.proc || manager.status().status !== "running") {
    return { status: "not_running", message: "没有运行中的任务" };
  }
  manager.markStopping();
  manager.proc.terminate();               // 终止信号，限时等待
  if (!await manager.proc.wait(TIMEOUT)) manager.proc.kill();  // 超时强杀
  manager.markIdle();
  return { status: "stopped", message: "已停止" };
}
```

失败分支与恢复策略：子进程异常退出置异常态并保留错误信息供面板展示；停止超时强杀后仍回空闲态；服务进程自身重启后状态归空闲（内存态，无持久化），面板通过状态查询收敛显示。

## 4. Acceptance

1. **成功路径**：启动请求后状态经启动中进入运行中，日志流可见采集输出，进程正常退出后回空闲态。
2. **拒绝路径**：运行中再次启动被拒绝并返回明确消息；空闲时请求停止返回未运行消息。
3. **失败路径**：子进程非零退出时状态置异常且错误信息可见，随后可重新启动新任务。
4. **强杀路径**：停止请求在超时后强制结束进程，状态回空闲，无残留采集进程。
5. **数据路径**：数据目录中的文件可被列出、预览与下载，越界路径访问被拒绝。
