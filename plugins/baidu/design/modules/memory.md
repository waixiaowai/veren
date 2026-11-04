---
title: memory 记忆备份
description: 清单、备份、列举与恢复安全网。
sidebar:
  order: 6
---
## 2.6 Memory

memory 以清单为中心完成记忆文件的备份、列举与恢复：它把宿主工作区里的长期记忆文件打成一个带清单的备份目录，上传到账号下的固定位置，并在恢复前于本地留一份安全网。它与相邻模块的分界是：memory 不承载普通文件操作（禁止用裸上传、裸下载命令直接操作记忆目录），也不判断"哪份记忆更重要"；它只保证清单可校验、路径可追溯、恢复可回退。

### 2.6.1 Capabilities

【实现】仅支持四类宿主（kimiclaw、maxclaw、qclaw、openclaw）；其余环境直接报错退出，不做兼容猜测。备份内容固定为 7 个记忆文件加 `memory/*.md`，并生成清单。

| 能力 | 行为 | 关键约束 |
|---|---|---|
| 环境识别 | 依据脚本路径特征与宿主标志识别四类宿主，并确定工作区与配置目录 | 识别失败即拒绝，不回落为默认目录 |
| 备份路径 | `/apps/bdpan/agent-memory/<宿主>/<设备>/manual/<时间戳>/` | 设备名统一小写并归一化，只保留字母、数字与连字符 |
| 备份内容 | 7 个记忆文件 + `memory/*.md` + `manifest.json` | 缺失的文件跳过并记录，不生成空占位 |
| 清单 | 版本、宿主、记忆系统名、设备、创建时间、备份类型、最后备份时间、触发次数、文件列表 | 文件路径必须为相对路径且不含穿越；校验失败即中止 |
| 列举 | 按宿主与设备列出可用备份目录 | 只读；路径展示为用户可见形式 |
| 恢复 | 按日期模糊匹配备份，下载清单与文件，写回工作区 | 写回前先做本地安全网备份；跨宿主恢复需显式强制 |
| 安全网 | 恢复前把当前记忆复制到 `<工作区>/.backup-before-restore/<时间戳>/` | 安全网失败则中止恢复，不冒险覆盖 |

### 2.6.2 Contracts

```ts
type AgentKind = "kimiclaw" | "maxclaw" | "qclaw" | "openclaw";

interface BackupManifest {
  version: "2.0";
  agent: AgentKind;
  memorySystem: string;                    // 记忆系统标识，如 memory-core
  device: string;                          // 归一化设备名
  createdAt: string;                       // 本地时间，秒精度，无时区后缀
  backupType: "manual";
  lastBackupAt: string;
  triggerCount: number;                    // 本次为 1
  files: string[];                         // 相对路径，禁止绝对路径与 ".."
}

interface BackupRequest {
  agent: AgentKind;
  workspaceDir: string;
  memoryDir: string;
}

interface BackupReceipt {
  remoteDir: string;                       // 服务端路径
  displayDir: string;                      // "我的应用数据/bdpan/agent-memory/..."
  fileCount: number;
  manifest: BackupManifest;
  skipped: string[];                       // 缺失或不合法的文件
}

interface RestoreRequest {
  agent: AgentKind;
  device: string;
  dateQuery: string;                       // 支持 "2026-03"、"2026-03-16"
  force: boolean;                          // 跨宿主恢复必须显式置真
}

interface RestoreReceipt {
  matchedBackup: string;                   // 命中的备份目录
  restoredFiles: string[];
  safetyNetDir: string;                    // 本地安全网目录
  warnings: string[];
}

abstract class MemoryVault {
  abstract backup(request: BackupRequest): Promise<BackupReceipt>;
  abstract list(agent: AgentKind, device: string): Promise<Array<{ path: string; displayPath: string; createdAt: string }>>;
  abstract restore(request: RestoreRequest): Promise<RestoreReceipt>;
}
```

错误约定：清单无效（缺字段、JSON 损坏、文件路径为绝对路径或含穿越）一律中止且不写回；恢复时若命中多个备份，按时间倒序取唯一最新并明确告知；跨宿主恢复在未强制时拒绝，不"自动尝试"。

### 2.6.3 Flows

```ts
async function backup(req: BackupRequest): Promise<BackupReceipt> {
  const env = detectAgent(req.workspaceDir);                  // 四类宿主之外直接抛错
  const files = collectMemoryFiles(env.memoryDir);            // 7 个记忆文件 + memory/*.md
  const manifest = createManifest(env, files);                // 相对路径 + 校验
  const dir = `/apps/bdpan/agent-memory/${env.agent}/${normalizeDevice(env.device)}/manual/${timestamp()}`;

  for (const file of [manifest, ...files]) {                  // 逐个上传，失败即中止并保留已上传清单
    const receipt = await command("upload", [file.local, `${dir}/${file.rel}`], { json: true });
    if (!receipt.ok) throw new BackupFailure(receipt.errorCode, `上传失败：${file.rel}`);
  }
  return { remoteDir: dir, displayDir: toDisplay(dir), fileCount: files.length, manifest, skipped: env.skipped };
}

async function restore(req: RestoreRequest): Promise<RestoreReceipt> {
  const backups = await list(req.agent, req.device);
  const hit = pickLatest(backups, req.dateQuery);              // 无命中 -> BDPAN_NOT_FOUND
  const manifest = await downloadManifest(hit);               // 校验失败 -> 中止
  const warnings = checkCompatibility(manifest, req);          // 跨宿主且未强制 -> 拒绝
  const safety = await localSafetyNet(req.workspaceDir);      // 失败 -> 中止
  const files = await downloadAll(hit, manifest.files);       // 逐项校验相对路径
  await writeBack(files, req.workspaceDir);                   // 覆盖前逐项写临时文件再替换
  return { matchedBackup: hit.path, restoredFiles: files.map(f => f.rel), safetyNetDir: safety.dir, warnings };
}
```

### 2.6.4 Acceptance

| 编号 | 前置条件 | 操作 | 预期结果 |
|---|---|---|---|
| MM-01 | 受支持的宿主、已登录 | 执行备份 | 远端出现时间戳目录，含清单与全部记忆文件；返回可读目录与文件数 |
| MM-02 | 不受支持的环境 | 执行备份 | 报错退出，不上传任何文件 |
| MM-03 | 已有一份备份 | 列举备份 | 返回该备份目录与创建时间；不修改远端 |
| MM-04 | 存在多份备份 | 按 `2026-03` 恢复 | 命中该月最新一份，返回安全网目录与警告列表 |
| MM-05 | 备份清单缺字段 | 恢复 | 中止，提示清单无效，不写回任何文件 |
| MM-06 | 清单文件路径含 `..` | 恢复 | 中止，提示路径非法，不写回 |
| MM-07 | 跨宿主备份 | 恢复但未加强制 | 拒绝，并说明需要显式强制 |
| MM-08 | 安全网写入失败 | 恢复 | 中止，原有记忆保持不变 |
| MM-09 | 恢复中途下载失败 | 恢复 | 已下载项写入临时目录后整体放弃；工作区不被部分覆盖 |
| MM-10 | 备份中某记忆文件缺失 | 备份 | 跳过该文件并在 `skipped` 中列出，其余照常上传 |
