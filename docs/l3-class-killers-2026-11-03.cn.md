# L3 类杀手三件：证据与账本（2026-11-03）

> 本文件是 L3 三项交付的**外部证据索引**：门禁的红绿原文、出站活性的代码/测试面、
> 看门狗混沌演练的判级账本与时延分位数。所有数字出自脚本或测试输出，不手写。
>
> 仓库：cms（`D:\cms`）与 cursour；证据文件在 `docs/evidence/l3-20261103/`。

## 1. 部署完整性门禁（L3①）

### 1.1 源码 import 入库断言（CI）

- 实现：`D:\cms\cmd\server\imports_tracked_test.go`（`TestLocalImportsPointAtTrackedFiles`）。
  遍历仓库内全部 `.go`，对每个 `cms/...` import 断言其目标在 `git ls-files` 清单内；
  目录 import 要求目录内至少一个入库文件。
- 红色方向（真实拦红）：构造未入库包 `internal/untrackedprobe` + 一个 import 它的测试文件，
  运行门禁得到：

  ```
  --- FAIL: TestLocalImportsPointAtTrackedFiles
      部署完整性门禁：1 个 import 指向未入库路径
          D:/cms/internal/imhub/zz_gate_red_test.go imports untracked cms/internal/untrackedprobe
  ```

  原文：`docs/evidence/l3-20261103/gate-red.log`。
- 绿色方向（删除构造物后）：`ok cms/cmd/server`，原文 `gate-green.log`。

### 1.2 运行时 rev 与部署脚本核对

- 进程启动打印：`[build] runtime version=… git_sha=… built_at=…`（`cmd/server/main.go`）。
- 公开身份面：`GET /versionz` → `{"version","git_sha","built_at"}`（`cmd/server/build_info.go`）。
- 部署脚本：`deploy/lib.sh::verify_build_rev` 把运行时 `git_sha` 与 `CMS_EXPECT_GIT_SHA`
  比对；不一致走回退路径（`deploy/deploy.sh`）；`scripts/deploy-local-pkg.sh` 传入
  发布构建点。
- 线上红绿（2026-11-03，生产 box）：

  ```
  runtime rev: {"git_sha":"79e89191", ...}
  [gate-check] build rev OK: 79e89191            → GREEN_OK
  [gate-check] build rev MISMATCH: runtime=79e89191 expected=deadbeef → EXPECTED_FAIL
  ```

  原文：`docs/evidence/l3-20261103/deploy-rev-gate.log`。
- 节点侧同规则：镜像 `LABEL org.opencontainers.image.revision` + 入口首行
  `[boot] image git_rev=…`；r9 容器实测 `git_rev=69cd81e1c4d2…`（02:39:53Z）。

## 2. 出站活性观测（L3②）

- 数据面：`internal/imhub/service.go` 新增 `lastSendOK`（成功时刻）与 `lastSendRet`
  （ret 原文，`"0"`/`"-14"`/`"transport"`/`""`）；`Reply` 用 `SendTextReceipt` 的回执写入。
- 接口面：`GET /v1/im/hub/session` 增 `last_send_ok_at`、`last_send_ret`（`routes.go`）。
- 管理台：微信通道页新增「最近发送成功 / 最近发送 ret」两行与独立的出站徽标
  （`wechat-outbound-live|idle|dead`），与轮询徽标分开——轮询活 ≠ 出站活。
- 测试（红绿在案）：
  - Go：`TestReplyRecordsSendLiveness`（成功推进 lastSendOK；-14 保留 ret 且不抹掉上次成功）、
    `TestSendReceiptCarriesMessageIDAndRet`。
  - Web：`wechat-page.test.tsx` 新增两例（轮询活 + 出站 -14 判死；最近发送成功态）。
- 效果：11-02 那种「-14 连发」不再需要翻库或看日志，会话 API 一屏可见。

## 3. 看门狗混沌演练（L3③）

### 3.1 账本

| 剧本 | 不变式 | 红（修复前） | 绿（修复后） |
|------|--------|--------------|--------------|
| ① 并发 tick（8 路 × 40ms 慢发送） | 同一待投事件只外打 1 次 | **8 次**（`chaos-red-concurrency.log`） | 1 次 |
| ② 账本重放（终态后重复 tick ×5） | 零新增外打 | — | 1 次（首次） |
| ③ 杀 worker（accepted 静默 + 并发看门狗/投递） | park 恰 1、负回复恰 1 | — | 1 / 1 |
| ④ 杀 cms（投递失败后重放 ×4） | 恰 1 次成功外打，失败留痕 | — | reply_failed=1、成功=1 |
| ⑤ 负控：死 token（-14 哨兵） | 永不误记成功；10 次后 failed 停打 | — | success=0、failed 停打 |

原文：`chaos-green.log`（逐测试 PASS）。判级器即测试断言，无人工判读。

### 3.2 红→绿修复面

并发 tick 的重复外打是演练**新抓出的缺陷**：`PendingReplies` 的「未回复」读与
`reply_sent` 写之间没有跨拍互斥，慢发送（真机 4.5s）与下一拍重叠即重复。修复 =
`Service.deliverMu` 串行化投递拍（`dispatch.go`），跨进程崩溃后仍是「至少一次」
（provider 无幂等键，契约不宣称跨崩溃恰一次）。

### 3.3 时延分位数（入档）

来源：生产 `taskhub_events`（matched→reply_sent）与录制反代 sendmessage 耗时。

| 指标 | n | p50 | p90 | max |
|------|---|-----|-----|-----|
| 任务 dispatch→delivered（新鲜跑，秒） | 3 | 4 | 12 | 12 |
| 任务 dispatch→delivered（11-02 事故滞留，秒） | 2 | — | — | 40014 |
| sendmessage 往返（ms） | 12 | 400 | 526 | 4504 |

原始：`docs/evidence/l3-20261103/latency.json`（含逐任务明细）。

## 4. 边界与未决

- 投递串行化是**进程内**的；多实例 cms 不在本波范围（单二进制部署形态）。
- 跨进程崩溃的重复外打无法用 iLink 幂等键消除（发送面无 idempotency key）；账本
  UNIQUE 只保证记录不重，不保证网络层不重。
- 活性面是内存事实：进程重启后 `last_send_ok_at=0`，管理台会显示「本进程尚未发送」，
  这是正确语义（不是故障）。
