---
title: 宿主
description: "决定一次思考在哪里发生：托管沙箱、用户设备或自建服务器，并管理配对、设备凭据、引擎清单、运行时令牌与工作区挂载。"
sidebar:
  order: 8
  label: 8 宿主
draft: false
lastUpdated: 2026-11-04
---

## 8. Host

宿主模块回答"这次思考在哪台机器上跑、用哪个引擎、凭什么相信自己有权限"。它保存宿主记录、设备凭据摘要、引擎清单与运行时令牌，并决定一个智能体的执行位置。它不解释智能体是谁，那是 [智能体](./agent/) 的事；也不判断回合该不该开始，那是 [回合](./turn/) 的事。它的核心是把凭据挡在模型进程之外，并让"设备"成为一个可撤销的凭据，而不是一个名字。

### 8.1 Duties

| 属于本模块 | 不属于本模块 |
| --- | --- |
| 宿主记录与类型（cloud、local、vps） | 智能体人格、技能与记忆（`Agent`） |
| 工作区长期配对码与单机重连码的校验 | 工作区成员与角色（`Workspace`） |
| 设备凭据的签发、摘要存储与撤销 | 人类会话令牌与登录（`Identity`） |
| 运行时令牌的签发、验签与放置变更复查 | 回合内工具调用与预算（`Turn`） |
| 心跳、在线判定与离线清扫 | 长连帧投递（`Realtime`） |
| 引擎清单、沙箱能力与不可运行原因 | 模型账号与提供方配置的归属（用户侧） |
| 工作区文件命名空间与挂载路径参数化 | 文件内容本身（`Agent` 的持久事实） |

### 8.2 Capabilities

宿主有三种类型：`cloud` 由平台托管、按工作区确定性地创建；`local` 是用户自己的桌面；`vps` 是团队自建的常驻服务器。三种类型共用同一套配对、心跳与运行时令牌语义，差别只在谁提供算力与隔离。

引擎不是等价的可执行文件，沙箱能力是清单的一等字段：

| 引擎 | 默认沙箱 | 说明 |
| --- | --- | --- |
| `managed` | 不适用 | 平台侧的回合循环，只在托管宿主上存在 |
| `claude` | 是 | 有最低版本要求与 Linux 侧沙箱依赖，原生 Windows 在安全模式下不可用 |
| `codex` | 是 | 有最低版本要求，原生 Windows 使用提权沙箱 |
| `grok`、`cursor`、`opencode`、`pi`、`gemini`、`qwen` 等 | 否 | 兼容性选项，只有显式打开不沙箱开关后才进入可运行清单 |

关键规则：

- **一个智能体同一时刻只属于一个宿主。** 归属是同一条记录上的引擎与主机字段，不是多份指派；移动宿主时服务端轮换指派标识，旧标识立刻失效。
- **配对是拿码换凭据。** 工作区长期配对码可重复使用，用于把新设备接进来；单机重连码只服务那一台已注册的设备。设备凭据是随机的不透明串，库里只存摘要，明文只在配对响应里出现一次。
- **设备是可撤销的凭据，主机名不是身份。** 这是本章的铁律：主机名由设备自报，可被任意伪造或撞名，因此任何以"同名即同一台机器"为前提的复用都必须有第二重凭据。当前实现对"工作区码加同主机名"允许重新接上已有设备，这是一处已记录的残余风险，收紧方案见待确认项。
- **运行时令牌是两小时的、窄范围的。** 声明里带智能体标识、租户、主机、指派标识与固定作用域；有效期两小时，守护进程在到期前五分钟换新。签名之外，每次请求还要回库复查租户、主机与指派标识，因此撤权不需要黑名单。
- **心跳三十秒，九十秒判离线。** 心跳只更新版本、监督模式、引擎清单与最后在线时间；状态翻转只在真正迁移时广播一次，健康心跳绝不因为一次数据库抖动而失败。
- **只有两个引擎默认在沙箱里。** 引擎清单里 `claude` 与 `codex` 是默认沙箱引擎，其余引擎需要显式打开"不沙箱"开关才进入可运行清单；仅仅在 `PATH` 上发现同名可执行文件不足以执行它，版本低于安全下限、缺少沙箱依赖都算不可运行，并把原因带到界面。
- **沙箱不可用即停止回合。** 不降级到宿主权限、不用宿主身份重试、不把失败解释成"引擎不兼容"；回合以明确失败收尾，并要求修复沙箱。
- **模型进程不持有令牌与服务地址。** 只有守护进程在沙箱外调用运行时接口；桥接程序放在智能体可写目录之外，会合目录不含任何凭据，请求在校验前先被原子认领。
- **工作区通过文件系统挂载进执行环境。** 挂载后端是运行时接口而不是数据库，路径参数化到令牌主体，因此伪造路径也读不到别的智能体的文件。
- **不沙箱开关是宿主级且显式。** 它一旦打开就恢复宿主权限、禁用提供方配置注入、并在启动时留下告警；服务端可以读到这个状态，因此"这台机器上跑的是宽权限或窄权限"是可审计的事实，而不是隐含假设。
- **旧守护进程必须仍然可用。** 设备版本独立于客户端发布，服务端新增字段只能追加，不能要求设备先升级；不认识的字段一律忽略，缺失的可选字段按关闭处理。

### 8.3 Contracts

```ts
type HostKind = 'cloud' | 'local' | 'vps'
type HostStatus = 'online' | 'offline' | 'busy'
type EngineId = 'managed' | 'claude' | 'codex' | 'grok' | 'cursor' | 'opencode' | 'pi' | 'gemini' | 'qwen'

interface Host {
  id: string
  companyId: string
  kind: HostKind
  hostName: string           // 仅供参考，永不作为身份
  status: HostStatus
  daemonVersion: string | null
  availableEngines: EngineId[]
  unsandboxedEnabled: boolean
  lastSeenAt: string | null
  revokedAt: string | null
}

interface BlockedEngine { engineId: EngineId; reason: string }   // 版本过旧、缺少沙箱依赖、平台不支持

interface DeviceCredential { hostId: string; tokenHash: string; issuedAt: string; revokedAt: string | null }

interface PairingCode { code: string; scope: 'workspace' | 'host'; hostId: string | null; expiresAt: string | null }

interface EngineAssignment { agentId: string; hostId: string; engineId: EngineId; assignmentId: string }

interface RuntimeGrant {
  token: string
  agentId: string
  hostId: string
  assignmentId: string
  expiresAt: string          // 签发后两小时
}

interface RuntimeSubject { agentId: string; companyId: string; hostId: string; assignmentId: string }

abstract class HostService {
  abstract pair(code: string, report: HostReport): Promise<{ host: Host; deviceToken: string }>
  abstract heartbeat(deviceToken: string, report: HeartbeatReport): Promise<HeartbeatAck>
  abstract mintRuntimeGrant(deviceToken: string, agentId: string): Promise<RuntimeGrant>
  abstract authorizeRuntime(token: string): Promise<RuntimeSubject>
  abstract moveAgent(scope: Scope, agentId: string, hostId: string, engineId: EngineId): Promise<EngineAssignment>
  abstract revokeHost(scope: Scope, hostId: string): Promise<void>
  abstract listRunnableEngines(hostId: string): Promise<{ runnable: EngineId[]; blocked: BlockedEngine[] }>
}
```

错误约定：配对码未知、过期或已被撤销返回 `401`，不区分是哪种；设备凭据被撤销返回 `401`，且下一次请求立即生效；指派已变更返回 `403`，并说明是放置变更或权限撤销；宿主声明不可运行引擎却收到派单是 `422`，回合不启动；运行时授权查询失败返回 `503` 而不是放行。稳定码见 [错误码与状态模型](../errors/)。

### 8.4 Flow

```ts
async function pair(deps: HostDeps, input: PairInput): Promise<PairResult> {
  // 1) 码即凭据：先按摘要定位作用域，长期码与单机码走同一张表但语义不同
  const scope = await deps.db.resolvePairingCode(deps.hash(input.code))
  if (!scope) throw new HostError('PAIRING_CODE_INVALID', 401)
  if (scope.expiresAt && deps.now() > scope.expiresAt) throw new HostError('PAIRING_CODE_EXPIRED', 401)

  // 2) 主机名不是身份：同名设备只能凭它自己的重连码复用，否则一律新建
  const existing = await deps.db.findHostByName(scope.companyId, input.hostName)
  if (existing && scope.scope !== 'host') throw new HostError('HOST_NAME_TAKEN', 409)
  if (existing && scope.hostId !== existing.id) throw new HostError('PAIRING_CODE_INVALID', 401)

  // 3) 设备自报清单只是候选，可执行集合由服务端按沙箱策略收窄
  const runnable = deps.engines.runnable(input.detected, { unsandboxed: input.unsandboxed })
  if (runnable.length === 0) throw new HostError('NO_RUNNABLE_ENGINE', 422)

  const host = existing ?? (await deps.db.insertHost({ companyId: scope.companyId, kind: input.kind, hostName: input.hostName }))
  const deviceToken = deps.randomToken(32)
  await deps.db.upsertCredential({ hostId: host.id, tokenHash: deps.hash(deviceToken), revokedAt: null })
  return { hostId: host.id, deviceToken, runnable }
}

async function authorizeRuntime(deps: HostDeps, bearer: string): Promise<RuntimeSubject> {
  const claims = deps.verifyJwt(bearer)                                  // 签名、固定作用域、过期
  if (claims.scope !== 'agent-runner') throw new HostError('RUNTIME_TOKEN_INVALID', 401)

  // 智能体标识只取自声明，永不信任请求体
  const placement = await deps.db.findAssignment(claims.sub)
  if (!placement) throw new HostError('RUNTIME_TOKEN_INVALID', 401)
  if (placement.assignmentId !== claims.assignmentId) throw new HostError('ASSIGNMENT_CHANGED', 403)
  if (placement.hostId !== claims.computerId || placement.companyId !== claims.companyId) {
    throw new HostError('ASSIGNMENT_CHANGED', 403)                      // 移动宿主或跨租户即失效
  }
  if (!(await deps.db.isHostActive(placement.hostId))) throw new HostError('HOST_REVOKED', 401)
  return { agentId: claims.sub, companyId: claims.companyId, hostId: placement.hostId, assignmentId: placement.assignmentId }
}
```

分支说明：配对码查不到与已过期对外都是 `401`，避免把"哪些码存在"变成可枚举信息；同名但非本机重连时返回 `409` 并提示使用重连码，而不是默默复用一台别人可能已经用过的设备；设备自报的引擎全部不可运行时返回 `422`，因为这时就算配对成功也没有任何东西能跑；运行时的每一步失败都给出不同的稳定码，但都不透露别的智能体的存在；授权查询失败返回 `503`，这是唯一允许"暂时不让进"的分支，方向仍是关闭而不是开放。

### 8.5 Recovery and Idempotency

- **心跳丢失**：九十秒无心跳判离线，该宿主上的智能体显示休息中；恢复后只广播一次状态迁移，消息留在服务端收件箱，上线后自行补读，不重放旧唤醒。
- **重复心跳**：心跳是幂等的状态上报，重复或乱序到达不会产生第二次状态广播，也不会把 `last_seen_at` 推回去。
- **凭据轮换**：移动宿主会轮换指派标识，旧运行时令牌在下一次请求即被拒；守护进程在到期前五分钟换新，换新失败时保留旧令牌到过期为止，不提前丢弃。
- **撤销设备**：设备行标记撤销，设备凭据、重连码与由它签发的运行时令牌同时失效；工作区长期码仍然有效，因为撤销的是设备而不是入口。
- **配对码轮换**：轮换只影响工作区码，已配对设备与单机重连码不受影响；旧码立即失效，正在进行的配对会失败并要求重新取码。
- **沙箱判定变化**：引擎版本升级或沙箱依赖补齐后需要重新探测；清单以最近一次可信上报为准，一次只报未知引擎的上报不会把已知清单清空，显式空扫描才会。
- **挂载后端不可达**：文件操作以输入输出错误失败，读不存在的路径返回不存在，超大文件在系统调用处被拒；正在进行的上传失败时保留脏标记，下一次同步重试，不会把半份内容当成完整文件。

### 8.6 Acceptance

| 编号 | 前置 | 操作 | 可观察结果 |
| --- | --- | --- | --- |
| HS-01 | 设备已配对并持有有效凭据 | 用该凭据为已指派智能体换取运行时令牌 | 返回两小时有效的令牌，声明含智能体、租户、主机与指派标识；令牌不写入设备配置文件以外的任何位置，日志中无明文 |
| HS-02 | 设备已被撤销 | 用旧设备凭据或旧运行时令牌请求运行时接口 | 返回 `401`，且当次即失败（无需等待过期）；该设备上的智能体不再接收唤醒 |
| HS-03 | 同一工作区已有一台同名在线设备 | 用工作区长期码再次配对同名主机 | 返回 `409` 并提示改用该设备的重连码；不产生第二台同设备，也不把新设备接到旧记录上 |
| HS-04 | 智能体已指派到宿主 A | 移动到宿主 B 后用旧令牌请求 | 返回 `403` 指派已变更；新令牌可正常请求，旧令牌在过期前一直不可用 |
| HS-05 | 宿主仅装有非默认沙箱引擎且未开不沙箱开关 | 服务端把该引擎派给该宿主 | 派单被拒（`422`），回合不启动，界面显示不可运行原因；绝不出现以宿主权限执行的回合 |
| HS-06 | 宿主在线并持续心跳 | 连续三次心跳后停止心跳超过九十秒 | 状态由在线转离线并只广播一次；期间智能体的消息不丢失，恢复后按收件箱补读 |
| HS-07 | 模型进程尝试读取凭据或服务地址 | 在沙箱内枚举环境变量与文件 | 环境与可读目录中都没有运行时令牌与服务地址；桥接目录在智能体可写范围之外 |
