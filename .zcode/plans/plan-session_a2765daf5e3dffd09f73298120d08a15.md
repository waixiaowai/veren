# IM 插件全生命周期计划：开发 → 测试 → 发现 bug → 修复 → 发布正式版

**目标态**：im 四包以 `@veren/im-bundle` 形态进入市场索引，版本线 **2.1.0**（MINOR：IM 能力上线，按版本规范），经测试环境真机验证（微信扫码收发全链路）→ 修复循环 → 预发布签发 → 正式版。

---

## 阶段 0：开发补齐（真机之前清掉已知问题）

**A. 修复探索发现的真 bug + 4 个 P3（每项带回归测试）**
1. **im_bind 补 `code` 参数**接通 `submitCode`——现在 `needs-code` 分支无工具入口，真机遇微信验证码会永久卡死（tool/src/tools.ts 参数表 + router 透传）
2. **QR PNG 清理**：bind 终态后 unlink `%TEMP%\dsh-im-wechat-qr\` 残留（现无任何清理路径）
3. P3a：`attempts` Map 终态 evict + intake 的 `asked/askTimes` 收缩与 dispose（core/src/bindings.ts:83、intake.ts:65）
4. P3b：`contactMatchOf` 回显用户原始输入而非存储值（core/src/people-resolve.ts:93）
5. P3c：index.ts 离群导入对齐 runtime-seams（一行）
6. P3d：`registerImTools` 226 行拆为每工具独立工厂（30 行硬约束，纯结构无行为变更）

**B. 新建 `plugins/im-bundle`**（骨架抄 forum-bundle：package.json + cordis.patch.yml + icon + locale + tests/bundle.spec.ts + 双语 README）
- patch 三行、顺序即依赖序：`im`（服务行，provide im/imRouter/imPeople）→ `im-tool`（inject imRouter）→ `im-wechat`（inject im）
- 不依赖 app-host-bundle（无 app/ui 层）；**testkit 不进 dependencies**（vitest 库非插件，避免被发布闭包拖上 registry）

**C. 市场接入两条**：`market/sources.txt` 加 `@veren/im-bundle`；`market/market.json` 补展示条目

**D. 版本线 bump 2.1.0**（全族统一）+ 门禁全绿（check:* + typecheck + im 四包 100 测试）

## 阶段 1：发布 → 测试环境真机验证（发现 bug 主战场）

1. `node market/release.mjs`——闭包自动带上 im-bundle 及 im 四包（2.1.0）
2. 测试环境（3080）`plugin add @veren/im-bundle@2.1.0` → 重启 → 验证清单：
   - 服务激活：im/imRouter/imPeople 无 inject 等待告警
   - 工具面：9 个 im_* 全局可见
   - **im_bind 真扫码**（需你配合约 2 分钟；不在场则 testkit fake 兜底先行，扫码挂起）→ bound 状态 + credentials 记录 + `im_wechat.json` 落域
   - im_send 实发一条；入站：从微信回消息 → 会话路由 + people 收录 + intake 审计
3. 每个 bug 按格式记录：现象 / 日志与存储证据 / 根因假设

## 阶段 2：修复循环（直到清单全绿）

每个真机 bug：根因修复 + 回归测试 → **PATCH bump（2.1.1、2.1.2…）** → 重新发布 → 测试环境复验。循环直至清单全绿。

## 阶段 3：预发布签发

- staging pin 升到 2.1.x → 重启 → 已存凭据复验授权（不重复扫码）→ AGENTS 真机清单 + im 专项
- `market/build.mjs` 重建市场索引（im-bundle 上架可见）+ 部署
- `RELEASE-NOTES.md` 签发（记录 harness commit + 清单结果）

## 阶段 4：正式版

- `git tag v2.1.x`；**你在桌面插件市场安装/更新**（agent 职责到此为止）
- 记忆归档 + 全程汇报

## 验收标准（整体完成的定义）

- registry 有 `@veren/im-bundle@2.1.x`，市场索引（market.veren.top）可见
- 测试环境微信双向打通：bind → send → 入站路由 → people/intake 全链路真机证据
- 预发布签发 signed；全部门禁与测试绿；发现的每个 bug 有回归测试

## 风险与依赖

- **微信扫码需你在场**（阶段 1，约 2 分钟）——不在场我先走 testkit 兜底道，扫码挂起等你
- iLink 是腾讯外部协议，可能踩到清单外分支（协议侧行为）——阶段 2 修复循环就是为此设计
- P3d 拆分是纯结构重构，无行为变更，风险最低