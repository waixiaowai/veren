---
title: delivery 分发与版本
description: 安装、登录、更新、卸载与版本对齐。
sidebar:
  order: 7
---
## 2.7 Delivery

delivery 负责让入口与内核始终配套：安装、登录脚本的安全边界、更新检查、卸载、完整性校验，以及技能包与命令二进制的发布产物。它与相邻模块的分界是：delivery 不参与业务调用、不判断用户意图；它只保证"装上的东西是对的、能验的、能回退的"，并把版本不匹配暴露给行为层。

### 2.7.1 Capabilities

【实现】四条链路：安装、登录、更新、卸载；一条发布链路：按技能版本号打标签并归档压缩包。

| 链路 | 行为 | 关键约束 |
|---|---|---|
| 安装 | 按平台与架构选择安装器，从分发网络下载并执行 | 下载后先做哈希校验，失败即删除并终止；支持"跳过下载、使用本地二进制"用于离线或自建分发 |
| 登录 | 展示安全须知与免责声明，取得确认后取授权地址，授权码经标准输入提交 | 授权码不得作为命令行参数；必须带免责声明确认开关；原任务前置登录时静默返回 |
| 更新（技能） | 查询配置接口的最新版本，与本地版本文件比较，下载压缩包并覆盖 | 仅在用户明确要求时执行；支持"只检查"；压缩包有哈希则校验 |
| 更新（命令） | 由命令自身管理版本检查 | 行为层不得自动替换安装；版本不符时提示用户决定 |
| 卸载 | 注销、删配置目录、删二进制 | 删除前必须确认；提供跳过确认开关仅供自动化 |
| 发布 | 版本文件变更触发流水线，按技能名与版本号打标签并归档 | 标签已存在则跳过，不覆盖已发布产物；压缩包排除缓存、临时文件与本地配置 |
| 版本对齐 | 技能包声明所需命令版本 | 版本不匹配时拒绝按旧行为执行，先提示升级 |

### 2.7.2 Contracts

```ts
type Platform = "darwin" | "linux" | "windows";
type Architecture = "amd64" | "arm64";

interface ReleaseArtifact {
  name: string;                            // 如 baidu-drive-1.7.7.zip
  version: string;                         // 技能版本
  platform?: Platform;                     // 技能包无平台，安装器有
  architecture?: Architecture;
  url: string;                             // 分发地址
  sha256: string;                          // 必填；缺失即视为不可安装
  bytes: ByteCount;
}

interface InstallPlan {
  artifact: ReleaseArtifact;
  installDir: string;                      // 缺省 ~/.local/bin
  configDir: string;                       // 缺省 ~/.config/bdpan
  skipDownload: boolean;                   // 离线：使用本地二进制
}

interface VersionContract {
  skillVersion: string;                    // 如 1.7.7
  requiredCommandVersion: string;          // 如 3.8.9
  installerPinnedVersion: string;          // 如 3.8.4
  compatible: boolean;                     // required <= installed 且主版本一致
}

interface UpdateCheck {
  current: string;
  latest: string;
  updateAvailable: boolean;
  notes?: string;
}

interface Installer {
  plan(input: { platform: Platform; architecture: Architecture; offlineBinary?: string }): InstallPlan;
  verify(artifact: ReleaseArtifact): Promise<boolean>;
  install(plan: InstallPlan): Promise<{ installedVersion: string; path: string }>;
  checkUpdate(component: "skill" | "command"): Promise<UpdateCheck>;
  uninstall(options: { purgeConfig: boolean }): Promise<void>;
}
```

错误约定：哈希不匹配、下载截断、解压失败都必须终止且清理临时文件，不得留下半装状态；更新失败保留旧版本可运行；版本不匹配属于"可解释失败"，必须给出当前版本、所需版本与升级入口。

### 2.7.3 Flows

```ts
async function ensureInstalled(): Promise<void> {
  if (commandExists("bdpan")) return;
  const plan = installer.plan({ platform: detectPlatform(), architecture: detectArch() });
  const ok = await installer.verify(plan.artifact);                 // 哈希不符 -> 抛错并清理
  if (!ok) throw new DeliveryFailure("BDPAN_INTEGRITY_FAILED", "安装包校验失败");
  const installed = await installer.install(plan);                  // 失败 -> 回滚临时目录
  assertPathOnPath(installed.path);                                 // 提示 PATH 配置方式，不擅自修改
}

async function assertVersionContract(skill: VersionContract, installed: string): Promise<void> {
  if (compareVersion(installed, skill.requiredCommandVersion) >= 0) return;
  throw new DeliveryFailure("BDPAN_VERSION_MISMATCH",
    `当前命令版本 ${installed} 低于技能要求的 ${skill.requiredCommandVersion}，请确认后升级`);
}
```

发布链路的顺序固定为：改版本文件、提交、由流水线检测变更并打标签、归档压缩包、发布产物；人工不得直接向已存在的标签补传产物，版本不可变是这条链路的前提。

### 2.7.4 Acceptance

| 编号 | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|
| DL-01 | 未安装、网络可用 | 触发安装 | 下载、校验、安装依次完成；`bdpan version` 可用 |
| DL-02 | 安装包被篡改 | 触发安装 | 校验失败，临时文件被删除，未安装任何内容 |
| DL-03 | 已有本地二进制 | 以离线模式安装 | 不下载，直接使用本地二进制并回报版本 |
| DL-04 | 已登录 | 执行登录脚本但未确认免责声明 | 中止，不取授权地址 |
| DL-05 | 授权成功 | 完成登录 | 凭据写入本机库，命令返回成功；授权码未出现在进程参数中 |
| DL-06 | 有新版本 | 只检查更新 | 返回当前版本与最新版本，不下载、不安装 |
| DL-07 | 更新包损坏 | 执行更新 | 失败并保留旧版本可运行 |
| DL-08 | 已安装 | 卸载并确认 | 注销、删除配置目录与二进制；提示 PATH 残留 |
| DL-09 | 技能版本高于命令版本 | 触发任意命令 | 返回版本不匹配，给出升级入口，不按旧版本降级执行 |
| DL-10 | 版本文件变更 | 推送触发流水线 | 生成对应标签与压缩包；重复触发不覆盖已有标签 |
| DL-11 | 压缩包内含缓存文件 | 发布 | 产物中不含缓存、临时文件与本地配置 |
