---
title: 工具链
description: 接口描述、SDK、命令行、智能体接入与配置推送。
sidebar:
  order: 38
  label: 工具链 Toolchain
lastUpdated: 2026-11-05
---

工具链是对外能力面的总称：它把服务端能力整理成一份可生成的接口描述，再派生出 SDK、命令行与智能体工具。它是外围域，但它是集成方实际接触系统的唯一表面，因此它的设计目标是「契约单一来源、失败可解释、破坏性操作有闸门」。

## 1. Responsibility

### 1.1 Boundary

| 相邻模块 | 工具链负责 | 不负责 |
| --- | --- | --- |
| 服务端接口 | 描述、生成、版本对齐 | 实现接口 |
| 定价目录 | 把配置推送到服务端 | 校验定价经济性（服务端为准） |
| 身份 | 承载密钥与授权码流程 | 签发权限 |
| 控制台 | 提供代码片段与调用示例 | 页面布局 |

## 2. Capabilities

1. 接口描述：以声明式契约维护接口清单、字段、示例与错误，作为 SDK 与文档的唯一来源。
2. SDK：按资源组织的类型化客户端，支持重试、超时、失败开放与幂等键透传。
3. 命令行：登录、初始化、推送、拉取、列出资源、查询事件、预览变更、危险操作。
4. 配置即代码：以单个 TypeScript 配置文件声明套餐与功能项，支持推送与回拉，回拉保留注释与变量名。
5. 智能体接入：以工具形式暴露查询与变更能力，写操作在智能体场景默认转为待确认动作。
6. 版本协商：请求携带接口版本，服务端按版本做请求与响应转换；旧版本保留转换层。
7. 失败开放：读类调用在服务不可用时返回保守结论而不是抛错，写类调用不启用失败开放。

## 3. Contracts

```ts
interface CliConfig {
  defaults: { env: "sandbox" | "live"; configPath: string };
  features: FeatureDefinition[];
  plans: PlanDefinition[];
}

interface PushReport {
  created: Array<{ kind: "feature" | "plan"; id: string }>;
  updated: Array<{ kind: "feature" | "plan"; id: string }>;
  versioned: Array<{ planId: string; from: number; to: number }>;
  archived: Array<{ kind: "feature" | "plan"; id: string }>;
  blocked: Array<{ id: string; reason: string }>;
}

interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  mutating: boolean;
  requiresConfirmation: boolean;
}

abstract class ToolchainService {
  abstract loadConfig(input: { path: string }): Promise<CliConfig>;
  abstract push(input: { config: CliConfig; env: "sandbox" | "live"; dryRun: boolean }): Promise<PushReport>;
  abstract pull(input: { env: "sandbox" | "live"; force: boolean }): Promise<{ files: string[] }>;
  abstract invokeTool(input: { name: string; args: Record<string, unknown>; intent: string }): Promise<unknown>;
}
```

## 4. Core Flows

### 4.1 Push

```ts
async function push(input: PushInput, ctx: ToolchainContext): Promise<PushReport> {
  const config = await loadConfig(input.path);
  const remote = await ctx.api.snapshot(input.env);              // 功能项 + 套餐 + 客户计数
  const diff = analyze(config, remote);
  if (diff.blocked.length > 0) throw new ToolchainError({ code: "TOOL-422-001", blocked: diff.blocked });
  if (input.dryRun) return diff.report;

  for (const feature of diff.createFeatures) {
    const created = await ctx.api.createFeature(feature);
    await ctx.state.record("feature:created", created.id);
  }
  for (const plan of diff.versionedPlans) {
    const result = await ctx.api.createPlanVersion(plan);
    await ctx.state.record("plan:versioned", result.id);
  }
  for (const target of diff.archiveTargets) {
    await ctx.api.archive(target);                                // 只归档，不删除
  }
  return ctx.state.report();
}
```

失败分支：任一步失败即停止后续，已成功项记录在本地状态文件，重试时按同一份差异重算；删除被引用对象时在本地即拒绝，不发送请求；生产环境推送需要显式确认参数，缺失即拒绝。

### 4.2 Pull

回拉把远端状态写回配置文件，优先原地更新以保留注释、顺序与变量名；结构变化过大时才整体重写。回拉不覆盖本地未推送的改动，发现冲突时列出冲突文件并中止。

### 4.3 Tool Invocation

智能体调用分两类：只读工具直接执行并返回结果；写入工具生成待确认动作，动作包含目标、影响预览与过期时间，确认后才执行。每个调用必须携带一句话意图，用于审计与人工复核。

## 5. Acceptance

| 编号 | 场景 | 前置 | 操作 | 预期 |
| --- | --- | --- | --- | --- |
| TOOL-A1 | 首次推送 | 远端为空 | 推送合法配置 | 功能项与套餐创建，报告列出全部新建项 |
| TOOL-A2 | 引用冲突 | 功能项被信用系统引用 | 从配置中删除该功能项 | 本地拒绝，返回 `TOOL-422-001`，不发请求 |
| TOOL-A3 | 断点重试 | 推送在第 2 项失败 | 重试 | 第 1 项跳过，从第 2 项继续 |
| TOOL-A4 | 回拉保留注释 | 配置文件含注释 | 回拉 | 注释与变量名保留，仅值更新 |
| TOOL-A5 | 智能体写操作 | 未确认 | 调用写入工具 | 生成待确认动作，不直接执行 |
| TOOL-A6 | 版本不兼容 | 请求旧版本接口 | 调用 | 服务端按旧版本转换响应，不报错 |
