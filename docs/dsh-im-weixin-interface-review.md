# dsh-im 微信通道：面向接口评审

> 评审尺子：**依赖倒置与契约边界**。不看代码风格、不看命名喜好、不看注释质量。
> 判据：调用方依赖的是「稳定契约」还是「具体实现的形状」——后者包括线格式字段、方法名字符串、私有副作用、持久化 schema、错误字面量。

## 评审范围与口径

只读对象（全部只读，未做任何修改）：

- `deepseek/dsh-im/src/channels/weixin/` 下 10 个文件：`config-store.mjs`(192) `connection-error.en.mjs`(137) `connection-error.mjs`(153) `diagnostic-details.mjs`(1) `harness-client.mjs`(19) `state-store.mjs`(291) `weixin-api.mjs`(949) `weixin-bridge.mjs`(1563) `weixin-controller.mjs`(683) `weixin-runtime.mjs`(433)

对照物：

- 新契约 `plugins/im/core/src/contract.ts`：`ImService` 六方法（`start`/`stop`/`accounts`/`listen`/`bind`/`send`，外加可选 `removeAccount`，`contract.ts:198-214`）与 `ImProvider` 描述符（`contract.ts:216-221`）。
- 设计文档 `veren-im-通用沟通工具设计方案.md`：分层依赖规则（`设计方案.md:165-173`）、错误码映射要求（`设计方案.md:427-429`）、`listen` 契约（`设计方案.md:494-500`）。

为了说清依赖方向，本文先定义层次（依据 `设计方案.md:165-173` 的同类划分）：

| 层 | 本评审中的文件 |
|---|---|
| L0 共享 | `src/channels/shared/*`（20+ 模块） |
| L1 传输 | `weixin-api.mjs` |
| L2 存储 | `config-store.mjs`、`state-store.mjs` |
| L3 诊断 | `connection-error.mjs`、`connection-error.en.mjs`、`diagnostic-details.mjs` |
| L4 桥接 | `weixin-bridge.mjs`（同时承载大量 DSH 业务语义） |
| L5 运行时 | `weixin-runtime.mjs` |
| L6 管理 | `weixin-controller.mjs` |
| L7 装配 | `plugin-src/host/channels/weixin/{production,rpc,index,connection-supervisor}.mjs` |

标注约定：正文条目均为已核实证据。「未验证」只出现在最后一节；凡未核实的内容不写进正文。

---

## 总评

这套实现没有通道接口，只有一台以 iLink 线格式为中心的运行时：传输字段、错误字面量和持久化 schema 由业务层直接读写，契约由方法名字符串和 `typeof` 探测临时拼凑。换渠道不是换适配器，而是重写业务层并迁移数据。

---

## 1. import 图与依赖方向

### 问题

**1.1（真问题）存储层反向依赖传输层。** 两个 store 各自直接 import `weixin-api.mjs`，把传输层知识固化进持久化格式。

**1.2（真问题）存储层依赖诊断层。** `state-store.mjs` 直接 import 错误码工厂，使「写文件失败」这类纯存储事件必须知道渠道错误目录。

**1.3（真问题）管理层解析传输 payload。** `weixin-controller.mjs` 直接消费 iLink 响应字段与状态字面量，而 `weixin-api.mjs` 明明可以用一层归一化把它挡住（`weixin-api.mjs:500-505` 只校验 `status ∈ LOGIN_STATUSES` 就原样透传）。

**1.4（阴性结论）10 个文件内部无 import 环。** 逐边核对完毕，环为 0。问题不是环，是方向。

### 证据

逐文件 import / 被 import（仅列本通道内与装配侧，测试略）：

表内 `路径:行号` 一律指该文件里的 import 语句行；`[层]` 为目标文件所在层。

| 文件 | import 了谁（`路径:行号 [层]`） | 被谁 import |
|---|---|---|
| `config-store.mjs` | `node:crypto:1`/`fs:2`/`path:3`；**`./weixin-api.mjs:5 [L1]`**；`../shared/i18n.mjs:6 [L0]`；`../shared/config-read-error.mjs:7 [L0]` | `weixin-controller.mjs:9`；`production.mjs:7` |
| `state-store.mjs` | **`./connection-error.mjs:1 [L3]`**；`../shared/deferred-state.mjs:2 [L0]`；`node:crypto:3`/`fs:4`/`path:5`；**`./weixin-api.mjs:7 [L1]`** | `production.mjs:9` |
| `connection-error.mjs` | `../shared/connection-error.mjs:1 [L0]`；`../shared/i18n.mjs:2 [L0]`；`./diagnostic-details.mjs:3 [L3]`；`../shared/config-read-error.mjs:4 [L0]` | `state-store.mjs:1`；`weixin-controller.mjs:2`；`weixin-runtime.mjs:1`；`production.mjs:16`；`index.mjs:5`；`rpc.mjs:5`；`connection-supervisor.mjs:1` |
| `connection-error.en.mjs` | 无（纯字典，137 行） | `src/channels/shared/i18n-en/weixin.mjs:1`；`plugin-src/client/i18n.js:3` |
| `diagnostic-details.mjs` | `../shared/diagnostic-details.mjs:1 [L0]`（全文 1 行 re-export） | `connection-error.mjs:3` |
| `harness-client.mjs` | `../shared/harness-client.mjs:1-3 [L0]`（仅改 `rpcIdPrefix`/`logPrefix`，`harness-client.mjs:15-16`） | `production.mjs:8` |
| `weixin-api.mjs` | `node:crypto:1-7`；`../shared/image-prompt.mjs:9 [L0]` | `config-store.mjs:5`；`state-store.mjs:7`；`weixin-controller.mjs:4-8`；`weixin-runtime.mjs:2`；`weixin-bridge.mjs:3-12`；`production.mjs:10-13` |
| `weixin-bridge.mjs` | `./weixin-api.mjs:3-12 [L1]` + **24 个 `../shared/*` [L0]**（`batch-input` `busy-message-dispatcher` `clear-command` `compact-command` `connection-test` `context-enhancement` `control-command` `deferred-delivery-coordinator` `harness-approval` `harness-question` `history-command` `i18n` `image-prompt` `inbound-access` `inbound-file` `message-failure` `model-command` `preset-command` `semantic/artifact-delivery` `semantic/delivery` `semantic/reply-reference` `session-reply-recovery` `workspace-command` `workspace-session`） | `weixin-runtime.mjs:4-6` |
| `weixin-controller.mjs` | `./connection-error.mjs:2 [L3]`；**`./weixin-api.mjs:4-8 [L1]`**；**`./config-store.mjs:9 [L2]`**；`../shared/connection-test.mjs:10-13 [L0]`；`../shared/message-failure.mjs:14 [L0]`；`../shared/i18n.mjs:15 [L0]` | `production.mjs:14`；`index.mjs:43` |
| `weixin-runtime.mjs` | `./connection-error.mjs:1 [L3]`；`./weixin-api.mjs:2 [L1]`；`./weixin-bridge.mjs:4-6 [L4]`；`../shared/{markdown-chunks:3,semantic/delivery:7,message-failure:8-10,connection-test:11-14,i18n:15} [L0]` | `production.mjs:15`；`index.mjs:44` |

具体反向边：

- `config-store.mjs:5` `import { normalizeWeixinApiBaseUrl } from './weixin-api.mjs'` —— L2 → L1。
- `config-store.mjs:56` 用它校验，`config-store.mjs:60-68` 把 `baseUrl` 写进账号记录（`baseUrl` 字段在 L65）。**结果：传输层端点被持久化进 config.json。**
- `state-store.mjs:7` `import { weixinMessageTimestampMs } from './weixin-api.mjs'`，调用于 `state-store.mjs:255`。该函数解的是 iLink 64 位消息 ID 的位布局（`weixin-api.mjs:26`、`weixin-api.mjs:916-928`）。**结果：消息 ID 的比特约定进入了状态层。**
- `state-store.mjs:1` `import { weixinStageError } from './connection-error.mjs'`，用于 `state-store.mjs:127`、`275`、`289` —— L2 → L3。
- `weixin-controller.mjs:4-8` 引入 `WEIXIN_QR_BASE_URL` 并在 `weixin-controller.mjs:160` 作为 `currentBaseUrl` 初值、`weixin-controller.mjs:34-38` 自行拼 URL（`apiBaseFromServer`）。
- `weixin-controller.mjs:441-499` 直接读 `response.status` 的 8 个 iLink 字面量（`wait`/`scaned`/`need_verifycode`/`verify_code_blocked`/`expired`/`scaned_but_redirect`/`binded_redirect`/`confirmed`）与 `response.bot_token`(L481)/`response.ilink_bot_id`(L482)/`response.ilink_user_id`(L483)/`response.baseurl`(L489)/`response.redirect_host`(L465)。

### 后果

- 更换传输协议时，`config.json` 的已落盘数据（`baseUrl`）和 `state.json` 的时间戳解码路径一起失效，必须写数据迁移；这与「新渠道只新增 provider 包」的目标（`设计方案.md:90`）直接冲突。
- store 在单测里必须连带 `weixin-api.mjs` 的常量与校验规则一起成立，存储层无法独立演进。
- 归一化被推迟到最上层（controller），中间所有层都能看到线格式，导致后面第 5 节的泄漏不可收敛。

---

## 2. 隐式全局与单例

### 问题

**2.1（真问题）模块级可变状态只有一处，但位置很关键：`ownedStages` 是一个模块级 `WeakMap`，用来给 `Error` 对象挂「失败阶段」元数据。** 这是一种隐式全局的旁路通道：阶段信息不在错误对象上，也不在任何可序列化字段里。

**2.2（真问题）消息与错误的用户可见文案由模块级可变语言开关决定，且没有任何注入点。** 10 个文件里所有 `t(...)` 都读同一个进程级 `language` 变量。

**2.3（真问题）协议常量与默认 `fetch` 是模块级的**，其中 CDN 上传 URL 与登录 URL 不可参数化，导致替换/测试只能靠拦截全局。

**2.4（阴性结论）10 个文件内没有 `process.env`、没有 `.dsh` 硬编码路径、没有 `homedir()`、没有模块级 `setInterval`/`setTimeout`、没有 `globalThis`。** 全部 `.dsh` 路径与 `DSH_HOME` 读取发生在装配根 `production.mjs:41-42`（`resolve(config.dshHome ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'))`、`join(root, 'integrations', 'dsh-weixin')`）与 `production.mjs:118`（`state.json`）。这是**好的**：10 个文件都通过构造参数接收路径（`config-store.mjs:99`、`state-store.mjs:119`）。

### 证据

- 模块级可变：`connection-error.mjs:74` `const ownedStages = new WeakMap();`，写于 `connection-error.mjs:103`，读于 `connection-error.mjs:137`（`chain.map(error => ownedStages.get(error)).find(Boolean) ?? {}`）。
- 模块级可变语言：`src/channels/shared/i18n.mjs:11` `let language = 'zh';`，`i18n.mjs:71-77` 的 `t()` 直接读它。调用点遍布：`connection-error.mjs:108-128`、`weixin-bridge.mjs:81`、`weixin-bridge.mjs:90-121`、`weixin-controller.mjs:194`、`weixin-runtime.mjs:268`。
- 协议常量：`weixin-api.mjs:11`（`WEIXIN_QR_BASE_URL`，同时被 `weixin-controller.mjs:160` 引用）、`weixin-api.mjs:17`（`WEIXIN_CDN_HOST`）、`weixin-api.mjs:19-22`（`ILINK_APP_ID`/`ILINK_CLIENT_VERSION`/两个超时）、`weixin-api.mjs:23-25`（上传重试/空闲超时/分片）。
- 全局 `fetch` 作为默认值：`weixin-api.mjs:184`、`weixin-api.mjs:226`、`weixin-api.mjs:507`（`createWeixinApi({ fetchImpl = fetch, uploadFetchImpl = fetchImpl })`）。注：`fetchImpl` 本身是可注入的，这一点是加分项；但 `beginLogin` 没有 `baseUrl` 参数（`weixin-api.mjs:637-646`，L641 写死 `baseUrl: WEIXIN_QR_BASE_URL`），而 `pollLogin` 有（`weixin-api.mjs:657`）——唯一不可注入端点的就是扫码入口。
- 版本字符串写死在线格式里：`weixin-api.mjs:310` `bot_agent: 'DeepSeekHarness/1.1.0'`。
- 私用 Symbol 旁路：`weixin-bridge.mjs:84` `const WEIXIN_SEND_DIAGNOSTIC = Symbol(...)`，写于 `weixin-bridge.mjs:185`，读于 `weixin-bridge.mjs:191-208`（五层 `cause` 链遍历找 Symbol）。这是另一个「错误对象之外的隐式通道」。
- 装配根的隐式全局（10 个文件之外，列出以便追责清晰）：`production.mjs:41`、`production.mjs:42`、`production.mjs:118`。

### 后果

- `ownedStages` 让「失败阶段」不可跨进程、不可序列化、不可被上层重抛后保留：任何 `catch → throw new Error(..., {cause})` 都会丢阶段；也只有本模块能读。阶段本该是错误对象上的结构化字段。
- 语言是全局的，意味着同一进程里两个 provider 无法用不同语言；测试断言中文文案时必须先设置全局状态，测试之间互相污染。这也是第 4 节里「中文句子当 key」的根因。
- `beginLogin` 不可注入 URL 使扫码流程无法在本地 mock server 上测试；`WEIXIN_CDN_HOST` 让图片/文件收发只能覆盖纯函数（解密），无法端到端。
- 版本字符串写死会产生「协议版本 vs 声明版本」漂移，且没有任何编译期约束。

---

## 3. 契约缺失

### 问题

**3.1（真问题）不存在「通道接口」这一层的文件。** 渠道一致性不是由契约保证的，而是靠三条并行的事实来源：一个 `assertController` 方法名清单、一堆 `typeof x !== 'function'` 探测、一个 `Proxy` 的方法名特判。

**3.2（真问题）没有共享基类，conformance 靠复制。** 现有 controller 中只有 3 个继承 `TokenBotController`（telegram/discord/imessage），其余各自独立；微信属于独立那一类，且把基类里已有的 `#runtimes`/`#errors`/`#transitions`/`#withBotTransition`/`#resolveToken`/`#touch` 又手写了一遍。7 个 bridge 继承 `TextHarnessBridge`（whatsapp/slack/telegram/imessage/matrix/discord/email），微信不在其中。

**3.3（真问题）调用方按字段名读对方状态，而不是调一个 `status()` 契约。** controller 直接读 `runtime.status.ready`、`runtime.status.weixinConnectionState`、`runtime.status.harnessReachable`、`runtime.status.messagesReceived` 等字段。

**3.4（真问题）同一个 `api` 对象在不同调用点有不同形状**，调用方到处试 `typeof`。

### 证据

- 「接口」的实际形态一：`plugin-src/host/channels/weixin/rpc.mjs:152-163`
  ```js
  if (!controller
    || typeof controller.status !== 'function'
    || typeof controller.startProvisioning !== 'function'
    || typeof controller.registrationStatus !== 'function'
    || typeof controller.submitVerification !== 'function'
    || typeof controller.cancelProvisioning !== 'function'
    || typeof controller.reconnectBot !== 'function'
    || typeof controller.deleteBot !== 'function') throw new TypeError('A complete Weixin controller is required');
  ```
  形态二：同一文件 `rpc.mjs:233-268` 又对 7 个方法各做一次 `typeof controller.updateX !== 'function'` 探测（`updateWorkspace`/`updateModel`/`updateBusyMessageMode`/`updateContextEnhancement`/`updateAlias`/`updateAccessPolicy`/`updateAgentPreset`）。
- 形态三：`production.mjs:210-227` 用 `Proxy` 只对 `deleteBot` 一个方法名做特判改写返回值。
- 形态四：`production.mjs:52-76` `diagnosticWorkspaces(store)` 把 10 个方法名写成两个 `Set`（`writes`/`removals`），用 `Proxy` 拦截；store 新增写方法时诊断包装静默不生效——接口由字符串枚举维持。
- controller 的构造期探测：`weixin-controller.mjs:87-102`，检查 `api.beginLogin/pollLogin`、`credentials.resolve/set/unset`、`configStore.list/save/remove`。注意 L87-88 只验证了 2 个 api 方法，L88 的报错文案却是「requires a Weixin API client」。
- 字段级耦合：`weixin-controller.mjs:269`、`weixin-controller.mjs:283`、`weixin-controller.mjs:297`（`runtime?.status?.ready`）；`weixin-controller.mjs:359-396` 读 `runtimeStatus.weixinConnectionState`(L361)、`harnessReachable`(L362)、`lastCheckedAt`(L389)、`messagesReceived/messagesReplied`(L392-393)、`lastMessageError`(L395)、`connectionError`(L370)。
- 状态对象本身是「拼出来的」：`weixin-bridge.mjs:289-300` `createWeixinBridgeStatus()` 与 `weixin-runtime.mjs:101-112` `createWeixinRuntimeStatus()`（L110 `...createWeixinBridgeStatus()`）；`weixin-runtime.mjs:115-128` 私有字段 `#status` 被桥和运行时共同就地改写（`weixin-runtime.mjs:211-223`、`weixin-runtime.mjs:273-277`；`weixin-bridge.mjs:519-520`、`647`、`677-686`、`944-948`）。
- api 形状漂移：`weixin-bridge.mjs:353` 必须有 `sendText`；`weixin-bridge.mjs:228-233` 可选 `inboundImages`/`inboundFiles`；`weixin-bridge.mjs:1384`、`weixin-bridge.mjs:1446` 可选 `sendTyping`；`weixin-bridge.mjs:1535-1540` 可选 `sendImage`/`sendFile`；`weixin-runtime.mjs:192` 对 `state.bindContextTokens` 用 `?.`；`weixin-runtime.mjs:356`、`weixin-runtime.mjs:383`、`weixin-bridge.mjs:426` 对 state 方法全部 `?.`。
- 「api」的唯一形式化定义是一个冻结字面量：`weixin-api.mjs:628-836` `return Object.freeze({ inboundImages, inboundFiles, beginLogin, pollLogin, getUpdates, getConfig, sendTyping, sendText, sendFile, sendImage, notifyStart, notifyStop })` —— 12 个方法，没有命名接口、没有类型、没有契约测试。
- controller 暴露的具体方法名（即「渠道事实被当成服务方法」的清单）：`initialize`(L111)、`reportRestoreFailure`(L137)、`startProvisioning`(L148)、`registrationStatus`(L206)、`submitVerification`(L210)、`cancelProvisioning`(L227)、`reconnectBot`(L243)、`sendConnectionTest`(L264)、`sendProactiveText`(L278)、`presentSessionSyncApproval`(L292)、`deleteBot`(L306)、`status`(L357)、`close`(L421)。

### 后果

- 任何调用方与微信之间的耦合都以「方法名字符串」为媒介，改名即破坏，且没有编译期或单测能拦住（`assertController` 只在运行时第一跳才报错）。
- 新增一个写操作（例如 `updateXxx`）时，`diagnosticWorkspaces` 与 `assertController` 都不会提醒你更新，错误会被静默吞掉或返回未包装的原始错误。
- 因为接口不存在，`production.mjs:204` 还要再套一层 `createWorkspaceAwareController`，`production.mjs:210` 再套一层 `Proxy`——同一个能力在 3 层里各有一次「按名字转发」。
- 「一个渠道一份实现」无法收敛：微信改变时无法从契约推出其他渠道是否受影响。

---

## 4. 错误处理

### 问题

**4.1（真问题）错误分类靠散落的字面量，且同一个魔数跨层重复。** `-14`（凭据失效）、`-2`（发送被拒）、`ret=0`/`errcode=0` 的判定分布在 api、bridge、runtime 三处。

**4.2（真问题）「错误码」是字符串命名空间，不是枚举，且未知码静默降级。** 64 个码集中在一个 `Object.freeze` 里，唯一导出的是 `knownWeixinErrorCode()` 谓词；未知码一律变成 `weixin-operation-failed`，调用方无法区分「已知但未处理」和「未知」。

**4.3（真问题）错误码在发送路径上是「透传 + 正则白名单」，不是映射。** 上层拿到的 `code` 是底层 `error.code` 经 `safeDiagnosticToken` 正则洗过之后的值，调用方因此无法枚举可能出现的码。

**4.4（真问题）`connection-error.mjs` 与 `connection-error.en.mjs` 是两份，而且不是语言分支：i18n 字典以「中文成品句子」为 key，`en` 文件是运行期查表数据。** 中文文件里既有权码表（`MESSAGES`），也有把码翻译成句子的逻辑（`describe`/`hintFor`）；`en` 文件则必须逐字复制这些句子作为 key。两份之间没有任何编译期或测试约束，**已经漂移 10 条**。

**4.5（真问题）行为分支建立在字符串形态上。** `code.startsWith('harness-')`、`code.startsWith('weixin-startup-')`、`/CERT|TLS|SSL/.test(reason)`、`reason === 'ENOTFOUND'`。

### 证据

魔数与字段名：

- `-14`：`weixin-api.mjs:817`（`providerCode === '-14' ? 'stale-token' : 'start-rejected'`）与 `weixin-runtime.mjs:267-268`（`providerCode === '-14' ? 'stale-token' : 'updates-rejected'`）。**同一判定写了两遍**，分别位于传输层与运行时层；漏改一处会导致 start 路径把凭据失效当普通失败重试 3 次（`weixin-runtime.mjs:236-250`）。
- `-2`：`weixin-bridge.mjs:200` `String(current.providerCode) === '-2'`，直接决定一段面向用户的提示文案。
- `ret`/`errcode` 判定：实现 `weixin-api.mjs:101-109`（`for (const field of fields) if (value[field] !== undefined && value[field] !== 0 && value[field] !== '0')`）；调用点 `weixin-api.mjs:558`（上传 URL）、`weixin-api.mjs:617`（文件消息）、`weixin-api.mjs:648`（扫码申请，字段序 `['errcode','ret']`）、`weixin-api.mjs:764`（文本消息）、`weixin-api.mjs:708`（`response.ret !== 0` 内联）、`weixin-api.mjs:733`（内联）、`weixin-api.mjs:815`（`['errcode','ret']`）、`weixin-api.mjs:832`（`['errcode','ret']`）、`weixin-runtime.mjs:264`（`['errcode','ret']`）。**同一个 helper，字段优先级各调用点不一致**：默认 `['ret','errcode']`（L101），其余显式反序。
- HTTP 状态散布：`weixin-api.mjs:72-83`（401/403/413/429 四段）、`weixin-api.mjs:111-119`（`>=500` 判为 uncertain）、`weixin-api.mjs:395`（`>=400 && <500`）、`weixin-api.mjs:402`（`!== 200`）、`weixin-runtime.mjs:46-47`（408/425/429/`>=500` 判可重试）。

码表与降级：

- `connection-error.mjs:6-72` `MESSAGES`（64 条）；码表对外只暴露一个谓词 `knownWeixinErrorCode(code) { return Object.hasOwn(MESSAGES, code ?? ''); }`（`connection-error.mjs:95`），没有导出码的枚举或联合类型；`connection-error.mjs:101` `error.code = knownWeixinErrorCode(code) ? code : 'weixin-operation-failed';`。
- 码 → 阶段映射：`connection-error.mjs:76-93` `CODE_STAGES`，与 `MESSAGES` 是两张必须同步的表（`MESSAGES` 有 64 条、`CODE_STAGES` 有 22 条，其余走 `defaults[0]` 为 `undefined` 的路径，见 `connection-error.mjs:143-144` 的 `?? context.stage` 兜底）。

发送路径的码透传：

- `weixin-bridge.mjs:179-180`：
  ```js
  const code = safeDiagnosticToken(error?.code);
  wrapped.code = code === '-' ? 'weixin-send-failed' : code;
  ```
  `safeDiagnosticToken` 定义于 `weixin-bridge.mjs:131-134`，正则 `/^-?[A-Za-z0-9_.:-]{1,160}$/u`。**任何满足该正则的底层字符串都会成为对外 `code`。**

字符串形态分支：

- `connection-error.mjs:110`（`code.startsWith('harness-')`）、`connection-error.mjs:115`（`startsWith('weixin-startup-')`）、`connection-error.mjs:123`（`/CERT|TLS|SSL/.test(...)`）、`connection-error.mjs:112-113`（`details.reason === 'ENOTFOUND' || 'EAI_AGAIN'`、`['EACCES','EPERM','EROFS'].includes(details.reason)`）、`connection-error.mjs:125-126`（`details.httpStatus === 429` / `401 || 403`）。

两份错误文件：

- 语言开关与查询：`src/channels/shared/i18n.mjs:1-5`（注释明说「dictionary keys are the exact Chinese source literals」）、`i18n.mjs:73`（`EN[text] ?? text`）。
- 中文句子即 key：`connection-error.mjs:7` `'credential-read-failed': '无法读取现有登录凭据。请检查 DSH 凭据存储。'` ↔ `connection-error.en.mjs:26` `"无法读取现有登录凭据。请检查 DSH 凭据存储。": "Could not read the saved login credential. ..."`。
- 还有一层间接：`hintFor` 返回的是 `t(...)` 拼出来的句子（`connection-error.mjs:108-128`），句子进 `publicError.message`（`connection-error.mjs:150`），前端再拿这句中文去查表（`plugin-src/client/i18n.js:3`）。**key 是运行期拼装的字符串，不是稳定标识。**
- 漂移实测：`MESSAGES` 的 64 条中文值中，有 10 条在 `connection-error.en.mjs` 中不存在，全部落在 `connection-error.mjs:62-71`：
  `workspace-not-absolute`(L62)、`workspace-not-found`(L63)、`workspace-not-directory`(L64)、`workspace-bot-not-found`(L65)、`agent-preset-invalid`(L66)、`agent-preset-unavailable`(L67)、`model-selection-invalid`(L68)、`model-selection-unavailable`(L69)、`model-reasoning-unavailable`(L70)、`context-enhancement-invalid`(L71)。
  （对照：`connection-error.en.mjs:14-16` 只覆盖了启动期配置校验用的另一批句子，措辞不同，不是同一 key。）

### 后果

- 调用方无法按码分支：唯一的稳定契约应当来自 `contract.ts:20-30` 的 `ImErrorCode`（10 个值），而现在对外可观察的码集合是「64 条字符串 + 任意合法 token + `weixin-send-failed`」，闭集不成立。
- `-14` 在两处各写一遍，是真实的分支重复；第三条路径（send）里 `-2` 又是另一套判断，无统一映射表可查。
- 10 条漏译在英文模式下直接显示中文（`i18n.mjs:73` 的 `?? text` 静默回退），用户可见；而且漏的不只是文案，这 10 条正好是工作区/模型/Preset 设置类错误——恰好是新增功能，说明「复制两份、手工同步」这种结构必然产生漂移。
- `ownedStages` + `CODE_STAGES` + `MESSAGES` 三张表要同时正确，才能产出一个带阶段的诊断；任何一张漏项都退化成 `weixin-operation-failed` 或空阶段，且不报警。

---

## 5. 传输层泄漏

### 问题

**5.1（真问题）长轮询循环在运行时层（业务层）。** `weixin-runtime.mjs` 自己写 `getUpdates` 的循环、自己读 `response.msgs`/`response.get_updates_buf`、自己判 `ret`。传输层的「轮询」语义没有被关进传输层。

**5.2（真问题）桥接层伪造线格式。** `weixin-bridge.mjs:450` 为了把批量输入的合并文本喂进后续流程，手工构造一个 iLink `item_list`。

**5.3（真问题）登录状态机在管理层，且 api 层刻意不归一化。** `weixin-api.mjs:500-505` 只校验 `status` 在白名单内就 `return value`（原样），于是 `weixin-controller.mjs:441-499` 必须知道 `bot_token`/`ilink_bot_id`/`ilink_user_id`/`baseurl`/`redirect_host` 这些线格式字段名。

**5.4（真问题）协议节奏被当成对外契约。** `weixin-controller.mjs:47` 在返回给调用方的 attempt 里写死 `pollIntervalMs: 1_000`，而 `#runProvisioning`（`weixin-controller.mjs:429-501`）里**没有任何 sleep**，全靠 `pollLogin` 的服务端长轮询（`weixin-api.mjs:666` 的 35s 超时）来阻塞。该字段既不真实，又把「谁控制轮询节奏」暴露给了调用方。

**5.5（真问题）持久化 schema 用协议名词命名。** 状态文件顶层的键直接叫 `getUpdatesBuf`、`contextTokens`、`seenMessageIds`。

**5.6（真问题）身份编码规则写进存储校验。** `config-store.mjs:17` 要求 `botId` 匹配 `^wx_[a-f0-9]{24}$`，`config-store.mjs:22` 要求 `tokenRef` 匹配 `^DSH_WEIXIN_BOT_TOKEN_[A-F0-9]{24}$`，两者必须等于 `deriveWeixinBotIdentity(accountId)` 的 sha256 结果（`config-store.mjs:25-33`、校验于 `config-store.mjs:51-53`）。这是「账号 id 派生方案」的实现细节，被存储层当成合法性判据。

### 证据

- 轮询循环：`weixin-runtime.mjs:253-303`。核心几步：`weixin-runtime.mjs:257-262` 取 `getUpdatesBuf` 调 `api.getUpdates`；`weixin-runtime.mjs:264-271` 判 `rejectedProviderResponse(response, ['errcode','ret'])` 与 `-14`；`weixin-runtime.mjs:279-287` 遍历 `response?.msgs`；`weixin-runtime.mjs:288-290` 读 `response?.get_updates_buf` 落盘。
- 排序语义在业务层：`weixin-runtime.mjs:84-99` `orderWeixinMessages` 按 `seq`/`create_time_ms` 排序，`weixin-runtime.mjs:86`。
- 桥接层读线格式：`weixin-bridge.mjs:385`（`message?.message_type === 2` 过滤出站）、`weixin-bridge.mjs:425`（`message?.context_token`）、`weixin-bridge.mjs:429-430`（`message.seq`、`message.create_time_ms`）、`weixin-bridge.mjs:239-255`（`item_list`/`text_item`/`image_item`/`file_item`）、`weixin-bridge.mjs:1013`（`hasWeixinImageItems`）。
- 伪造线格式：`weixin-bridge.mjs:448-453`，L450 `item_list: [{ type: 1, text_item: { text: result.prompt } }]`。
- 打字状态码：`weixin-bridge.mjs:1417`（`status: 1`）、`weixin-bridge.mjs:1456`（`status: 2`）、`weixin-bridge.mjs:1487`（`status: 1`）；`weixin-api.mjs:718` 校验 `status !== 1 && status !== 2`。
- 诊断串里的端点名：`weixin-bridge.mjs:160` `'endpoint=sendmessage'`。
- 登录字段：`weixin-controller.mjs:481-489`（`response.bot_token`、`response.ilink_bot_id`、`response.ilink_user_id`、`response.baseurl`）、`weixin-controller.mjs:465`（`response.redirect_host`）、`weixin-api.mjs:500-505`（只校验不归一化）。
- `start()` 也带传输握手：`weixin-runtime.mjs:193` → `#notifyStart`（`weixin-runtime.mjs:235-251`）→ `weixin-api.mjs:805-820`；`stop()` 同理 `weixin-runtime.mjs:319-323` → `weixin-api.mjs:822-835`。
- 持久化键名：`state-store.mjs:9-15`（`EMPTY_STATE` 的 5 个键）、`state-store.mjs:107`（`getUpdatesBuf`）、`state-store.mjs:21`（`CONTEXT_TOKEN_LIMIT`）、`state-store.mjs:99-110`（`normalizeContextTokens`）。
- 身份正则：`config-store.mjs:17`、`config-store.mjs:22`、`config-store.mjs:51-53`。
- 传输端点进配置：`config-store.mjs:56`、`config-store.mjs:65`。

### 后果

换一个通道，需要动的地方（按影响排序，全部为已核实文件）：

1. `weixin-api.mjs` 整份（949 行）——协议编解码、鉴权头、CDN 上传四段握手。
2. `weixin-controller.mjs:441-499` 登录状态机 + `weixin-controller.mjs:34-38` URL 处理 + `weixin-controller.mjs:47` 轮询节奏 + `weixin-controller.mjs:160` 常量。
3. `weixin-runtime.mjs:253-303` 轮询循环 + `weixin-runtime.mjs:84-99` 排序 + `weixin-runtime.mjs:235-251` 启停握手。
4. `weixin-bridge.mjs:385`、`425-431`、`448-453`、`1417/1456/1487`、`597-638`（引用消息回溯）。
5. `state-store.mjs:9-15` 持久化键名 + `state-store.mjs:37-50` token 形状 → **需要数据迁移**。
6. `config-store.mjs:17/22/56/65` 身份与端点校验 → **需要数据迁移**。
7. `connection-error.mjs:6-72` 64 条码表 + `connection-error.en.mjs` 137 行字典。
8. `production.mjs:41-48` 数据目录命名 + `production.mjs:88-94` api 装配。

**共 8 个文件，其中 3 个是落盘格式**。这直接违反设计文档「新渠道只需新增 provider 包，不改核心」（`设计方案.md:90`）与分层规则「Provider 禁止依赖 DSH Session / 路由层」（`设计方案.md:170`）。

---

## 6. 状态与生命周期

### 问题

**6.1（真问题）`WeixinHarnessBridge` 是上帝对象。** 1563 行、32 个实例字段、30 个方法，同时拥有 10 类互不相关的状态：去重、访问策略、命令路由、批量输入、交互/审批状态机、打字保活、分段发送、附件投递、引用回溯、延迟投递。

**6.2（真问题）投递语义既不是至多一次也不是至少一次。** 运行时把消息 `void accept()` 丢出去（不 await）之后立刻推进持久化游标；桥接层有 6 处是「先发消息、后 `markSeen`」。前者会丢消息，后者会重复回复。

**6.3（真问题）去重有两套 owner，互相不知道。** 持久化 `seenMessageIds`（上限 1000，线性 `includes`）与内存 `#acceptedMessageIds` 各管一段；`markSeen` 在桥接层有 17 个调用点，时机不一致（其中 6 处在发送之后）。

**6.4（真问题）`stop()` 的清理不完整。** `bridge.close()` 自己不取消挂起的 interaction，只靠 `#process` 的 `finally` 顺带清；单独调用 `close()`（测试、未来其他调用方）会留下悬空 interaction 到超时。运行时 `stop()` 后 `#startContext` 不清空。

**6.5（真问题）凭据被送进状态层。** 运行时把原始 `token` 交给 `state.bindContextTokens(token)`，由 state-store 自己算 hash。虽然只落 hash（`state-store.mjs:141-143`），但「凭据进入持久化对象」这个调用形状本身是所有权错位。

### 证据

上帝对象的度量：

- 定义：`weixin-bridge.mjs:302`；字段：`weixin-bridge.mjs:303-335` 共 32 个（`#api` `#baseUrl` `#token` `#ownerUserId` `#harness` `#state` `#deferred` `#contextEnhancement` `#accessPolicy` `#status` `#logger` `#replyTimeoutMs` `#maxMessageChars` `#typingKeepaliveMs` `#signal` `#queues` `#busyMessages` `#pendingInteractions` `#interactionKeys` `#acceptedMessageIds` `#approvalTasks` `#commandTasks` `#approvals` `#batchInputs` `#typingTicket` `#typingTarget` `#typingTimer` `#typingGeneration` `#typingTail` `#typingClosed` `#typingRetryAt` `#typingTicketStale`）。
- 方法数：`accept`(L383) `#enqueueMessage`(L566) `#inboundMessage`(L591) `#loadReplyContent`(L597) `#finishBatchResult`(L640) `#finishAccessDecision`(L669) `#deliverDeferredOutcome`(L699) `waitForIdle`(L704) `close`(L718) `#processFastCommand`(L724) `#process`(L779) `#processInteractionReply`(L995) `presentSessionSyncApproval`(L1125) `#handleInteraction`(L1131) `#handleInteractionResolved`(L1218) `#presentInteraction`(L1230) `#discardResolvedInteractionReply`(L1249) `#takePendingInteraction`(L1262) `#clearPendingInteraction`(L1271) `#cancelPendingInteraction`(L1275) `#handleInteractionFailure`(L1294) `#send`(L1313) `#sendOutOfBand`(L1360) `#queueTyping`(L1370) `#startTyping`(L1378) `#stopTyping`(L1439) `#scheduleTyping`(L1473) `#clearTypingTimer`(L1506) `#resumeTyping`(L1511) `#deliverArtifacts`(L1518)。

投递语义：

- 游标先于处理：`weixin-runtime.mjs:279-287`（`for (const message of orderWeixinMessages(response?.msgs)) { void this.#bridge.accept(message).catch(...) }`）紧接 `weixin-runtime.mjs:288-290`（`await this.#state.setGetUpdatesBuf(response.get_updates_buf)`）。**`accept` 未被 await，游标已前进。**
- 先发后记：`weixin-bridge.mjs:804-805`（`await this.#send(...)` 然后 `await this.#state.markSeen(...)`）；同样顺序见 `weixin-bridge.mjs:812-813`、`weixin-bridge.mjs:818-819`、`weixin-bridge.mjs:824-825`、`weixin-bridge.mjs:831-834`、`weixin-bridge.mjs:847-848`。
- 对照：设计文档要求「消息先持久化去重，再回调」（`设计方案.md:498`）。

去重：

- 持久化环：`state-store.mjs:13`、`state-store.mjs:104-106`（`.slice(-1_000)`）、`state-store.mjs:188-190`（`includes`）、`state-store.mjs:195-197`。
- 内存环：`weixin-bridge.mjs:323`（`#acceptedMessageIds`，注释「Keep the accepted configuration through the existing queue/reply lifecycle」），使用点 `weixin-bridge.mjs:388-389`、`L403`、`L411`、`L493`、`L524`、`L543`、`L662`、`L692`、`L859`。
- `markSeen` 共 17 个调用点：`weixin-bridge.mjs:518`、`644`、`675`、`736`、`805`、`812`、`818`、`824`、`834`、`848`、`869`、`943`、`962`、`988`、`1006`、`1251`、`1303`；其中 `805`/`812`/`818`/`824`/`834`/`848` 这 6 处发生在「已经发出一条用户可见消息」之后。

清理：

- `weixin-bridge.mjs:718-722`：
  ```js
  async close() { this.#deferred.close(); this.#typingClosed = true; await this.#stopTyping({ signal: AbortSignal.timeout(5_000) }); }
  ```
  **没有遍历 `#pendingInteractions` 调 `#cancelPendingInteraction`**（对比 `weixin-bridge.mjs:1275-1292` 的实现）。当前唯一的清理来自 `weixin-bridge.mjs:907-911`（`#process` 的 `finally`）与 `weixin-bridge.mjs:1275`。
- 运行时 `stop()`：`weixin-runtime.mjs:305-333`（abort L310 → `bridge.close()` L313 → 等 monitor L314 → `waitForIdle` L315 → `notifyStop` L319）。`#startContext` 在 `weixin-runtime.mjs:172` 赋值，**全程未重置**；`#status.startedAt`（L181）也不重置。
- controller `close()`：`weixin-controller.mjs:421-427`。
- 状态文件删除：`state-store.mjs:271-278`（`#deferred` 由闭包读 `#state.deferred`，`EMPTY_STATE` 无该键；`deferredStateAccess` 在 `deferred-state.mjs:18`、`deferred-state.mjs:41` 对 `undefined` 有兜底，**此处无缺陷**）。

所有权错位：

- `weixin-runtime.mjs:192` `await this.#state.bindContextTokens?.(this.#token);` → `state-store.mjs:140-145`（`createHash('sha256').update(token)`）。
- `context_token` 的写入方是桥（`weixin-bridge.mjs:426-431`），读取方是运行时（`weixin-runtime.mjs:356`）与桥（`weixin-bridge.mjs:1315`），落盘方是 store（`state-store.mjs:151-167`）——三方共享，无单一 owner。`state-store.mjs:152` 在 `contextTokens` 尚未建立时**静默 return**，不报错、不计数。
- 游标 `getUpdatesBuf` 同理由三方共管：写 `weixin-runtime.mjs:289`，读 `weixin-runtime.mjs:260`，持久化 `state-store.mjs:201-209`。

### 后果

- 崩溃窗口有两个方向：游标先推进 → 未处理消息永久丢失；先发送后 `markSeen` → 重启后重复回复。两者叠加，语义无法用「至少一次/至多一次」描述，也无法靠重试策略修正。
- 上帝对象使得任何一处行为变更都要理解 10 类状态的相互作用；30 个方法里 26 个是私有的，公开入口只有 `accept`/`waitForIdle`/`close`/`presentSessionSyncApproval` 4 个，单测只能从 `accept()` 进，覆盖成本极高。
- `close()` 不完整意味着「停止」这个契约动作不幂等、不彻底，直接冲击新契约对 `stop()`/`unlisten()` 的期望（`设计方案.md:301`「取消后释放长轮询」，`contract.ts:199-200`）。
- `#startContext` 泄漏会让上一轮的 operation 上下文被下一轮 `#notifyStart` 重试日志复用（`weixin-runtime.mjs:245-247`）。

---

## 7. 可测试性

### 问题

**7.1（真问题）时钟不可注入。** `Date.now()` 直接在 6 处以上调用，TTL/过期/时间窗逻辑无法确定性测试；`AbortSignal.timeout()` 在 4 处硬用，`vi.useFakeTimers()` 不会推进原生 timeout。

**7.2（真问题）扫码入口不可注入 URL，CDN 主机被写死。** `beginLogin` 没有 `baseUrl` 参数；`WEIXIN_CDN_HOST` 让图片/文件链路只能测纯函数。

**7.3（真问题）部分间隔常量不可注入。** 引用回溯的 `pageSize`/`maxPages`/`timeoutMs`/`toleranceMs` 是模块级常量，构造参数只暴露了 `typingKeepaliveMs`。对比之下 `startRetryDelaysMs` 是注入的（**这点做对了**）。

**7.4（真问题）异步副作用与断言交织。** 处理任一条消息都会启动打字保活定时器（`weixin-bridge.mjs:854`），测试必须显式 `close()` 才能让进程退出；`close()` 又不取消 pending interaction（见 6.4），测试会挂到 `replyTimeoutMs`（默认 600000，`weixin-bridge.mjs:348`）。

### 证据

- 时钟：`state-store.mjs:66`（`new Date().toISOString()`）、`state-store.mjs:155`（`receivedAt: Date.now()`）、`state-store.mjs:214-215`（`sentAt = Date.now()`、`completedAt = Date.now()`）、`state-store.mjs:238`（`now = Date.now()`）、`weixin-bridge.mjs:520`（`lastMessageAt = new Date().toISOString()`）、`weixin-bridge.mjs:1320`（`sentAt = Date.now()`）、`weixin-runtime.mjs:181`、`weixin-runtime.mjs:213`、`weixin-controller.mjs:155-156`。
  - 例外（可注入）：`state-store.mjs:238` 的 `recentOutboundTextFor({ now })` 与 `state-store.mjs:80` `recentOutboundMessages(value, now = Date.now())`；但 `rememberContextToken`（`state-store.mjs:155`）与 `rememberOutboundMessage`（`state-store.mjs:214-215`）不可。
- 原生 timeout：`weixin-bridge.mjs:721`、`weixin-bridge.mjs:1286`、`weixin-bridge.mjs:1439`、`weixin-runtime.mjs:322`。
- 不可注入的 URL：`weixin-api.mjs:637-646`（`beginLogin` 无 `baseUrl`，L641 固定 `WEIXIN_QR_BASE_URL`）；`weixin-api.mjs:318-332`（`trustedWeixinCdnUploadUrl` 要求 host === `WEIXIN_CDN_HOST` 且 path === `/c2c/upload`）；`weixin-api.mjs:159-181`（`weixinImageDownloadUrl` 同）。
- 不可注入的间隔：`weixin-bridge.mjs:85-88`（100/3/5000/15000）用于 `weixin-bridge.mjs:619-622`；构造参数在 `weixin-bridge.mjs:350` 只给了 `typingKeepaliveMs`；`weixin-controller.mjs:25` `QR_TTL_MS = 5 * 60_000`。
- 可注入的对照项（加分）：`weixin-runtime.mjs:146`/`weixin-runtime.mjs:32-41`（`startRetryDelaysMs`）；`weixin-api.mjs:507`（`fetchImpl`）；`weixin-bridge.mjs:350`（`typingKeepaliveMs`）；`config-store.mjs:99`/`state-store.mjs:119`（路径）。
- 随机数：`weixin-controller.mjs:153`（`randomUUID()` 作 attemptId）、`weixin-api.mjs:527-528`（`fileKey`/`aesKey`）、`weixin-api.mjs:581`（deliverySeed 兜底）、`weixin-api.mjs:743`（clientId）。发送类断言只能靠正则匹配。
- 私有无从下手：`weixin-bridge.mjs:1313` `#send`、`weixin-bridge.mjs:1473` `#scheduleTyping`、`weixin-runtime.mjs:253` `#runMonitor`、`weixin-controller.mjs:429` `#runProvisioning` 全为私有方法，测试无法直达，只能构造完整对象图从公开入口间接触发。
- 构造依赖面：`weixin-bridge.mjs:337-352` 需要 `api`+`baseUrl`+`token`+`ownerUserId`+`harness`+`state`（6 个必需）+ `contextEnhancement`/`accessPolicy`/`status`/`logger`/`replyTimeoutMs`/`maxMessageChars`/`typingKeepaliveMs`/`signal`（8 个可选）。要测一条命令分支，需要先备齐整套。

### 后果

不 mock 全局的前提下，能测的东西被压到很小一撮：

**能测（无需 mock 全局）：**

- 纯函数：`splitWeixinText`（`weixin-api.mjs:937`）、`weixinMessageTimestampMs`（`weixin-api.mjs:916`）、`extractWeixinReplyReference`（`weixin-api.mjs:877`）、`extractWeixinText`（`weixin-api.mjs:839`）、`parseWeixinImageAesKey`（`weixin-api.mjs:128`）、`decryptWeixinImage`（`weixin-api.mjs:145`）、`normalizeWeixinApiBaseUrl`（`weixin-api.mjs:255`）、`orderWeixinMessages`（`weixin-runtime.mjs:84`）、`deriveWeixinBotIdentity`/`maskWeixinAccountId`（`config-store.mjs:25`/`35`）、`weixinSendError`（`weixin-bridge.mjs:176`）。
- 协议层：注入 `fetchImpl` 后可测 12 个方法的请求构造与响应判定（`weixin-api.mjs:507`）——但 `beginLogin` 除外。
- 两个 store：注入真实临时路径即可，无需 mock `fs`（`config-store.mjs:99`、`state-store.mjs:119`）。

**测不了 / 只能靠真实时间：**

- 任何 TTL 与过期行为（`WEIXIN_RECENT_OUTBOUND_TTL_MS`、`QR_TTL_MS`、去重环上限的时间窗）。
- 扫码全流程（URL 不可注入 + 5 分钟 TTL + 无 sleep 的紧循环，用假 api 会变忙等）。
- 打字保活（`#scheduleTyping` 私有 + `AbortSignal.timeout` 不随假时钟推进）。
- 引用消息回溯的两级恢复（`weixin-bridge.mjs:597-638`，私有 + 常量不可注入 + 依赖 `harness.workspaceSession`）。
- 并发/竞态（`#queues`、`#transitions`、`#typingTail` 三套串行化机制交错，无测试钩子）。

---

## 8. 与新契约的落差

新契约只有 6 个方法 + `removeAccount?`（`contract.ts:198-214`）与一个 `ImProvider` 描述符（`contract.ts:216-221`）。老实现有 13 个 controller 公开方法 + 12 个 api 方法与一堆字段级状态。逐条对齐如下——**「渠道事实」被当成了「服务方法」的地方，方法名在此点名**。

### 问题与证据

**(1) 账号级 `start`/`stop` vs provider 级 `start`/`stop`**

- 老：`WeixinController` 持有 `#runtimes: Map<botId, WeixinRuntime>`（`weixin-controller.mjs:70`），启停按账号：`#startRuntime`（`weixin-controller.mjs:602-623`）、`#stopRuntime`（`weixin-controller.mjs:625-636`）；`WeixinRuntime.start`（`weixin-runtime.mjs:169`）/`stop`（`weixin-runtime.mjs:305`）都是单账号、单连接。
- 新：`start()`/`stop()` 是 provider 级（`contract.ts:199-200`），per-account 只有可选的 `removeAccount`（`contract.ts:213`）。
- **落差：账号级「重连/重启但保留账号」在新模型里没有位置。** 老实现有独立方法 `reconnectBot(botId)`（`weixin-controller.mjs:243`），它只能被压成 `stop()` + `start()`（影响其他账号）或 `removeAccount`（删掉账号）——两者语义都不对。

**(2) 「轮询副作用」当成服务方法**

- 老：`registrationStatus(attemptId)`（`weixin-controller.mjs:206-208`），配合 `startProvisioning`（L148）返回的 `attemptId`，调用方反复查询；配套字段 `pollIntervalMs`（L47）、`verificationUrl`（L45）、`expiresAt`（L46）。
- 新：`bind()` 返回的是活对象 `ImBindAttempt`，有 `status`/`challenge`/`submitCode?`/`wait(signal)`/`cancel()`（`contract.ts:150-157`）。
- **落差：`registrationStatus` 是「把 provider 内部状态机的推进节奏暴露为查询方法」。** `ImBindAttempt` 明确不提供 `poll()`；`pollIntervalMs` 在 `ImBindChallenge`（`contract.ts:138-146`）里也没有对应字段。

**(3) 二维码渲染当成服务方法的输出**

- 老：controller 返回 `verificationUrl`，RPC 层再编码成 data URL：`rpc.mjs:136-142`（`withEncodedQr`）与 `rpc.mjs:127-134`（`QRCode.toDataURL`），字段名 `qrCodeDataUrl`（`rpc.mjs:140`），缓存于 `rpc.mjs:167-179`。
- 新：`ImBindChallenge.imagePath`——**本地 PNG 路径**，且注释明确 `url` 永不外泄（`contract.ts:140-143`）。
- **落差：`verificationUrl`/`qrCodeDataUrl` 是把「传输挑战长什么样」当成服务返回值。** 新契约里二维码的渲染与落盘是 provider 侧的事，对外只给路径。

**(4) 隐式 target 当成服务方法**

- 老：`sendConnectionTest(botId)`（`weixin-controller.mjs:264-276`）→ `runtime.sendConnectionTest`（`weixin-runtime.mjs:335-352`），其中 target 是**猜出来的**：`connectionTestTarget(this.#state)` 或 `config.ownerUserId`（`weixin-runtime.mjs:336-341`）。
- 新：`ImSendRequest.target` 强制显式（`contract.ts:163-168`，注释「`target` is always explicit」）。
- **落差：`sendConnectionTest` 把「发给谁」藏进服务方法。** 同一问题见 `sendProactiveText(botId, target, text, options)`（`weixin-controller.mjs:278-290`）：它的 `target` 形状是 `{kind:'user', route:{toUserId}}`（`weixin-runtime.mjs:407-409`），不是 `ImSendTarget{accountId, conversationId}`（`contract.ts:159-162`）。

**(5) DSH 审批/交互当成服务方法**

- 老：`presentSessionSyncApproval(botId, target, interaction, options)`（`weixin-controller.mjs:292-304`）→ `weixin-runtime.mjs:396-404` → `weixin-bridge.mjs:1125-1129`（`#approvals.handleSessionSyncRequested`）。
- 新：`ImService` 无对应方法；审批是路由层/工具层的事（`设计方案.md:150-153`、`contract.ts:195-197`「intentionally carries only the six operations」）。
- **落差：「会话同步审批」是 DSH 的 UI 概念，被挂到 provider 的服务面上。**

**(6) 账号"认领"当成 provider 的职责**

- 老：扫码结果 `binded_redirect` 时，provider 自己挑一个已有账号认领：`weixin-controller.mjs:467-478`（`this.#configStore.list().find(config => this.#runtimes.get(config.botId)?.status?.ready === true) ?? this.#configStore.list()[0]`），并置 `record.alreadyConnected = true`（L477），对外经 `publicAttempt` 的 `alreadyConnected`（L50）暴露。
- 新：`bind()` 解析为 `ImAccount`（`contract.ts:155`）；`ImBindStatus` 里没有 `already-bound` 之类状态（`contract.ts:148`）；也没有字段承载「这次登录跟上一次是同一个账号」。
- **落差：`alreadyConnected` 是渠道事实（iLink 的 `binded_redirect`），被做成了 attempt DTO 字段。**

**(7) 富 status 当成服务方法**

- 老：`status()`（`weixin-controller.mjs:357-419`）返回 `schemaVersion`(L402)、`revision`(L403, 由 `#touch` L680-682 递增)、`state`(L404-412)、`bots[]`(L413)、`totals`(L414)、`provisioning`(L416)；每个 bot 带 `health.{status,summary,lastCheckedAt}`(L382-390)、`stats.{messagesReceived,messagesReplied}`(L391-394)、`lastMessageError`(L395)、`error`(L396)。
- 新：`accounts(): Promise<ImAccount[]>`（`contract.ts:201`），`ImAccount.status` 只有 `'online'|'offline'|'error'`（`contract.ts:64`）。
- **落差：`revision`/`schemaVersion`/`health.summary`/`stats`/`lastMessageError`/`provisioning` 全是 UI 形态，没有契约位置。** 这些若留在 provider 上，等于让 provider 负责渲染；若交给 router，则 router 必须自己聚合——两条路都要现在决定，否则迁移时会被迫保留 `status()`。

**(8) `listen` 的边界放错了深度**

- 老：`accept(message)`（`weixin-bridge.mjs:383`）接收的是**原始 iLink 消息**（`item_list`/`from_user_id`/`message_type`，见 L385、L387、L390、L425-431），归一化发生在更里面的 `weixinInboundMessage`（`weixin-bridge.mjs:212-236`）。
- 新：`listen(handler)` 的 handler 收到的是已归一化的 `ImMessage`（`contract.ts:202-205` + `contract.ts:102-119`）。
- **落差：provider 内部归一化没问题；但 `accept` 的入参形状说明「归一化点」在 provider 深处，而不是在 `listen` 边界。** 迁移时要决定：把 `weixinInboundMessage` 上提到 `listen` 的出口（对），还是让 router 继续吃线格式（错，等于把第 5 节泄漏搬到 core）。

**(9) provider 直接依赖 DSH Session**

- 老：`#loadReplyContent`（`weixin-bridge.mjs:597-638`）用 `this.#state.sessionFor(key)`（L608）拿到 sessionId，再 `this.#harness.workspaceSession?.(sessionId, key)`（L610），然后 `session.readHistory`（L612 `typeof session?.readHistory !== 'function'`）配合 `recoverAssistantTextByTimestamp`（`weixin-bridge.mjs:615-623`）。
- 新/设计：Provider **禁止依赖 DSH Session**（`设计方案.md:170`）；`replyTo` 只是消息字段（`contract.ts:116`），引用恢复属于路由层。
- **落差：这是整份实现里最硬的一条越界**——provider 为了补全引用文本，直接读 DSH 会话历史。

**(10) 计时能力声明了但用不上**

- 老：实现了 `getConfig`（`weixin-api.mjs:692-712`）与 `sendTyping`（`weixin-api.mjs:714-737`），桥接层做保活（`weixin-bridge.mjs:1378-1437`）。
- 新：`ImFeatures.typing: boolean`（`contract.ts:127`）只是声明，`ImService` 没有任何 typing 操作。设计文档已明确微信 V1 声明 `typing: false`（`设计方案.md:232-234`），所以这是**已知的、有意为之的取舍**，不算缺陷；但迁移时 400+ 行打字逻辑会无处安放，必须显式删除或下沉为 provider 内部私有行为（不暴露）。

**(11) 术语二义：`botId` vs `accountId`**

- 老：一个账号同时有两个标识——`accountId`（平台值）与 `botId`（`wx_` + sha256 前 24 位，`config-store.mjs:28-31`）；config 记录两者都存（`config-store.mjs:60-68`），controller 以 `botId` 为 key（`weixin-controller.mjs:530-540`，`#runtimes`/`#errors`/`#transitions` 全按 `botId`）。
- 新：`ImAccount.id` 是「provider-scoped account id」（`contract.ts:56-58`）。
- **落差：迁移时必须明确 `ImAccount.id` 取哪一个。** 取 `botId` 则凭据 key 依赖它（`config-store.mjs:31`），取 `accountId` 则所有已落盘目录名（`production.mjs:118` 的 `statePath`）要改。

### 后果

- 6 个方法装不下 13 个管理方法 → 迁移时必然出现「私有旁路」（provider 上留非契约方法，由 rpc 直接调），等于把现在的 `assertController` 换个地方重现。
- (2)(3)(4)(5)(7) 若照搬，新契约会被动扩张成「微信形状」，下一个渠道（邮箱/QQ）无法实现——正是 `设计方案.md:66-70` 警告的「假设了微信的模型」。
- (9) 不解决就无法通过 `@veren/im-testkit` 的 conformance（假 provider 不提供 DSH Session），也无法在无 DSH 环境下测试。

---

## 对照表：每个「面向实现」的点 vs 面向接口应有的样子

| # | 现状（面向实现） | 证据 | 面向接口应有的样子 |
|---|---|---|---|
| 1 | 渠道「接口」= 方法名清单 + `typeof` 探测 | `rpc.mjs:152-163`、`rpc.mjs:233-268` | 一个 `ImService` 实现类（`contract.ts:198-214`），编译期检查；调用方只 `import type` 契约 |
| 2 | 诊断包装靠 10 个方法名硬编码进 `Set` | `production.mjs:52-76` | 存储接口自带失败语义（返回 `Result` 或统一 `ImError`），不靠拦截方法名补包装 |
| 3 | 装配侧 `Proxy` 特判 `deleteBot` | `production.mjs:210-227` | `removeAccount` 在契约里定义失败语义与 warnings 形状，提供方自己保证 |
| 4 | store 直接 import 传输层校验 URL | `config-store.mjs:5`、`config-store.mjs:56`、`config-store.mjs:65` | 存储只接受已归一化的 `string` 端点；URL 合法性由 provider 在 `bind()` 时校验，配置不持久化端点 |
| 5 | store 直接 import 传输层解码消息 ID | `state-store.mjs:7`、`state-store.mjs:255` | 时间戳由 provider 归一化成 `ImMessage.sentAt`（`contract.ts:111-112`），store 只见 `number` |
| 6 | store 依赖错误码工厂 | `state-store.mjs:1`、`state-store.mjs:127/275/289` | store 抛 `ImError('IM_INTERNAL')`，附 `providerCode`；不 import 渠道错误目录 |
| 7 | 持久化键名用协议名词 | `state-store.mjs:9-15`、`state-store.mjs:107` | 键名与协议无关（`cursor`/`capabilities`/`dedupe`/`recentOutbound`），provider 内部翻译 |
| 8 | 管理调用方解 8 个登录状态字面量 + 5 个响应字段 | `weixin-controller.mjs:441-499`、`weixin-api.mjs:500-505` | api 层返回归一化 DTO（`{status:'pending'|'scanned'|'needs-code'|'bound'|'expired'|'failed', account?, challenge?}`），controller 只见 DTO |
| 9 | 轮询循环 + 游标推进在运行时层 | `weixin-runtime.mjs:253-303` | 循环关进 `listen()` 内部，对 router 只暴露 handler 回调（`contract.ts:202-205`）；游标在 provider 内推进 |
| 10 | 桥接层伪造 `item_list` | `weixin-bridge.mjs:450` | 内部统一用 `ImMessage`/`ImMessageContent`（`contract.ts:96-119`），线格式只在 api 层构造 |
| 11 | 打字状态码 1/2 出现在桥接层 | `weixin-bridge.mjs:1417/1456/1487` | 传输层暴露 `sendTyping(kind:'start'|'stop')`，或按 `features.typing` 决定不做 |
| 12 | 魔数 `-14` 在两个模块各写一遍 | `weixin-api.mjs:817`、`weixin-runtime.mjs:267` | `-14 → ImError('IM_AUTH_REQUIRED')` 只映射一次，且只在 provider 边界（`设计方案.md:429`） |
| 13 | `-2` 直接决定用户文案 | `weixin-bridge.mjs:200` | `-2 → IM_SEND_REJECTED`；文案由 router 按 `code` 查（`设计方案.md:428`） |
| 14 | 对外 `code` 是「透传 + 正则白名单」 | `weixin-bridge.mjs:179-180`、`weixin-bridge.mjs:131-134` | 闭集 `ImErrorCode`（`contract.ts:20-30`）+ `providerCode` 透传（`contract.ts:36-37`） |
| 15 | 64 个字符串码，未知码静默降级 | `connection-error.mjs:6-72`、`connection-error.mjs:101`、`connection-error.mjs:95` | 10 个枚举码；未知一律 `IM_INTERNAL` 并**记录下来**，不静默改写 |
| 16 | 错误阶段存在模块级 `WeakMap` | `connection-error.mjs:74/103/137` | 阶段是错误对象上的结构化字段（如 `ImError.details.stage`），可序列化、可跨进程 |
| 17 | 发送诊断藏在模块私用 `Symbol` | `weixin-bridge.mjs:84/185/191-208` | 诊断是 `ImError` 的结构化字段或 `unknown` 的 cause 链，不用私有 Symbol |
| 18 | 中英两份错误文件，key 是中文成品句子 | `connection-error.mjs:7`、`connection-error.en.mjs:26`、`i18n.mjs:1-5/71-77` | 错误码 → 本地化由 UI 层按 `code` 查表；provider 只产出 `code` + 结构化字段 |
| 19 | 10 条错误文案漏译 | `connection-error.mjs:62-71` | 不存在「两份手工同步表」这个问题本身 |
| 20 | 账号级 start/stop，`reconnectBot(botId)` 独立存在 | `weixin-controller.mjs:243`、`weixin-controller.mjs:602-636` | provider 级 `start/stop`（`contract.ts:199-200`）；账号重连由 router 组合 `removeAccount`+`bind` 或 provider 内部自动重连 |
| 21 | `registrationStatus` + `pollIntervalMs` 暴露推送节奏 | `weixin-controller.mjs:206-208`、`weixin-controller.mjs:47` | `ImBindAttempt.status` + `wait(signal)`（`contract.ts:150-157`），无轮询方法、无节奏字段 |
| 22 | `verificationUrl` / `qrCodeDataUrl` 作为返回值 | `rpc.mjs:127-142`、`weixin-controller.mjs:45` | `ImBindChallenge.imagePath`（本地 PNG），`url` 不出 provider（`contract.ts:140-143`） |
| 23 | `sendConnectionTest(botId)` 自己猜 target | `weixin-controller.mjs:264-276`、`weixin-runtime.mjs:336-341` | `send({target, content})`，target 必须显式（`contract.ts:163-168`） |
| 24 | `sendProactiveText` 的 target 是 DSH 路由 DTO | `weixin-controller.mjs:278-290`、`weixin-runtime.mjs:407-409` | `ImSendTarget{accountId, conversationId}`（`contract.ts:159-162`） |
| 25 | `presentSessionSyncApproval` 挂在 provider 上 | `weixin-controller.mjs:292-304`、`weixin-bridge.mjs:1125-1129` | 审批留在 router/工具层（`设计方案.md:150-153`）；provider 只实现 6 方法 |
| 26 | `alreadyConnected` / `binded_redirect` 认领 | `weixin-controller.mjs:467-478`、`weixin-controller.mjs:50` | `bind()` 解析为 `ImAccount`；账号已存在就返回该账号，不新增 DTO 字段 |
| 27 | 富 `status()` 承担 UI 渲染 | `weixin-controller.mjs:357-419` | `accounts()` 给最小状态（`contract.ts:201`）；`revision`/`stats`/`health` 由 router 聚合 |
| 28 | provider 读 DSH 会话历史补引用 | `weixin-bridge.mjs:597-638`（L608/L610/L612） | provider 只回填 `replyTo`（`contract.ts:116`）；历史恢复由 router 做（`设计方案.md:170`） |
| 29 | `accept()` 吃线格式，归一化在深处 | `weixin-bridge.mjs:383-431`、`weixin-bridge.mjs:212-236` | 归一化点在 `listen` 出口，handler 只见 `ImMessage` |
| 30 | 先发消息后 `markSeen`、游标先于处理 | `weixin-bridge.mjs:804-805` 等 6 处、`weixin-runtime.mjs:279-290` | 先持久化去重再回调（`设计方案.md:498`）；游标只推进到已确认处理的位置 |
| 31 | 凭据传进持久化对象 | `weixin-runtime.mjs:192`、`state-store.mjs:140-145` | 凭据只在 `ctx.credentials`；store 只见 `tokenRef`（`设计方案.md:130`） |

---

## 若要迁到 @veren/im 接口，要拆哪几刀

按性价比排序（价值 / 风险）。每一刀都标注影响面与风险；前两刀不改任何对外行为，可以先做。

### 第 1 刀：立契约壳，把 13 个方法收成 6 个

- **做法**：新增 `provider.ts`，实现 `ImService`；`start/stop` 转 `initialize()`+`close()` 与每账号 runtime 的启停；`accounts()` 由 `status().bots` 降维；`listen(handler)` 在内部把 `accept` 的产出转成 `ImMessage`；`bind()` 用 `startProvisioning`+`submitVerification`+`cancelProvisioning`+状态机包装成 `ImBindAttempt`；`send()` 用 `sendProactiveText` 并强制显式 target；`removeAccount` 用 `deleteBot`。其余 5 个方法（`reportRestoreFailure`/`registrationStatus`/`reconnectBot`/`sendConnectionTest`/`presentSessionSyncApproval`）**不进入契约**，暂留在 provider 内部或上移 router。
- **影响面**：新增 1 个文件；`production.mjs` 返回值改为注册 `ImProvider`；`rpc.mjs` 改为经 `ctx.im` 取 provider；`index.mjs:43-44` 的导出要保留（外部可能依赖）。
- **风险**：低。纯新增 + 转发，不改老逻辑。唯一要现在拍板的是 `status()` 的富字段去向——建议先砍到 `ImAccount.status`，`stats`/`health` 另存一个非契约的旁路接口给 UI，短期接受 UI 退化。
- **前置**：无。

### 第 2 刀：修投递语义（最便宜的止损）

- **做法**：`weixin-runtime.mjs:279-290` 改成「先收集本批 `messageId`，逐条 `await accept()` 完成（或至少 `await` 到 `markSeen` 已落盘），再 `setGetUpdatesBuf`」；`weixin-bridge.mjs` 的 6 处「先发后记」改为「先 `markSeen` 再发」。若担心丢回复，改成「先落一条 pending 记录，发送成功后确认」。
- **影响面**：`weixin-runtime.mjs:253-303`、`weixin-bridge.mjs:804-834/847-848/943`、`state-store.mjs` 新增一个 pending 区（可复用 `deferred` 机制，`state-store.mjs:134-137`）。
- **风险**：低-中。会改变吞吐（不再并发 accept），可能暴露长跑任务阻塞轮询的问题，需要用 `#queues` 的现有串行化兜住。**这是当前唯一会丢消息/重复回复的真 bug，收益最高。**
- **前置**：无（不依赖第 1 刀）。

### 第 3 刀：把 iLink 线格式钉回 api 边界

- **做法**：①`beginLogin` 增加 `baseUrl` 参数（`weixin-api.mjs:637`）；②`pollLogin` 返回归一化 DTO（`status` 映射到 6 态 + `account?{token,accountId,ownerUserId,baseUrl}` + `challenge?`），`weixin-api.mjs:500-505` 不再原样透传；③`weixin-controller.mjs:441-499` 改为消费 DTO，删除 `apiBaseFromServer`（L34-38）与 `WEIXIN_QR_BASE_URL` 引用（L6/L160）；④`getUpdates` 返回 `{messages: NormalizedInbound[], cursor: string}`，把 `ret`/`errcode` 判定与 `-14` 映射收进 api；⑤桥接层 `weixin-bridge.mjs:450` 的伪造 `item_list` 删除，改为内部结构直接传递。
- **影响面**：`weixin-api.mjs`、`weixin-controller.mjs:441-499`、`weixin-runtime.mjs:253-303`、`weixin-bridge.mjs:383-431/450`；测试可开始用本地 mock server 覆盖扫码全流程。
- **风险**：中。`binded_redirect`、`scaned_but_redirect`、`verify_code_blocked` 三个状态必须显式建模，否则行为变化；`weixin-controller.mjs:467-478` 的账号认领逻辑要跟着改写（见第 4 刀）。

### 第 4 刀：错误码闭集化（ImError）

- **做法**：删 `MESSAGES`/`CODE_STAGES`/`ownedStages` 三张表，改为「一处映射表：内部码 → `ImErrorCode` + `providerCode`」；`-14`/`-2`/`ret` 判定只在 `weixin-api.mjs` 出现一次；所有 throw 改为 `ImError`；阶段放 `ImError` 的结构化字段；`weixin-bridge.mjs:179-180` 的码透传删除；中英文案移交 UI 按 `code` 渲染。
- **影响面**：`connection-error.mjs`（153 行）、`connection-error.en.mjs`（137 行）、全部 `weixinStageError(...)` 调用点、`rpc.mjs:276-286` 的 endpoint→stage 映射表、前端 `plugin-src/client/i18n.js`。
- **风险**：中-高。用户可见文案会整体重排（10 条漏译一起修，用户可见变化）；`connection-error.en.mjs` 被两个消费方引用（`shared/i18n-en/weixin.mjs:1`、`plugin-src/client/i18n.js:3`），删除要同批改。

### 第 5 刀：持久化 schema 去协议化（要数据迁移）

- **做法**：`state.json` 键改为 `cursor`/`capabilities`/`dedupe`/`recentOutbound`；`config.json` 移除 `baseUrl`（或塞进 `providerData` 私有块）；`botId`/`tokenRef` 的正则校验从 store 移除（`config-store.mjs:17/22`），改由 provider 在 `bind()` 生成与自检。配 migration：读旧键 → 写新键，保留旧文件备份。
- **影响面**：`config-store.mjs`、`state-store.mjs`、`production.mjs:118` 的目录命名、已落盘数据（`~/.dsh/integrations/dsh-weixin/*` 之类，**本次未读取、未验证**）。
- **风险**：高。数据迁移失败会丢账号绑定；必须「先备份、幂等迁移、失败 fail loud」（`设计方案.md:740-745`）。**做这刀之前必须先有 e2e 基线**，否则回归无法判定。

### 第 6 刀：拆 `WeixinHarnessBridge` 上帝对象

- **做法**：按 6 个职责切文件（每个 ≤300 行，符合仓库规范）：`dedupe`、`access-and-commands`、`interaction-approval`、`typing`、`outbound-send`（含分段/附件）、`quote-recovery`；`#status` 收敛成独立的 `StatusStore`，`weixin-controller.mjs:359-396` 改为调它的方法而非读字段。
- **影响面**：`weixin-bridge.mjs` 1563 行；`weixin-runtime.mjs:114-167`（构造参数）、`weixin-controller.mjs:269/283/297/359-396`（字段读点）、所有引用 `WeixinHarnessBridge` 的测试（`test/channels/weixin/weixin-bridge.test.mjs`、`test/history-bridge.test.mjs` 等）。
- **风险**：高。行为回归面最大，且当前没有可用的行为基线；收益是「可测性」与「后续可维护」而非立刻可交付。**放在迁移后做**，或与前几刀解耦、单独立项。

### 不建议现在做的

- **把 `presentSessionSyncApproval` 抽象进 core**：它是 DSH 概念，一旦进契约，邮箱/QQ 都要被迫实现一个用不上的方法。正确做法是让它离开 provider 服务面。
- **给 `ImService` 加 `status()`/`revision`**：会把 UI 形态钉进契约，重演「假设了微信的模型」。
- **为打字指示扩展契约**：设计文档已决定微信 V1 `typing: false`（`设计方案.md:232-234`）；400 行打字逻辑应删除或降为 provider 内部行为，不该提升为能力。

---

## 口味偏好（不计入上述判断，仅记录）

以下不是「面向实现编程」的缺陷，属风格/规范层面，单列以免污染正文：

1. 文件名 `weixin-api.mjs`/`weixin-bridge.mjs` 在 `weixin/` 目录下前缀冗余。
2. `diagnostic-details.mjs` 只有 1 行 re-export（`diagnostic-details.mjs:1`），只为把 `normalizeDiagnosticDetails` 改名成 `normalizeWeixinDiagnosticDetails`；可直接删。
3. `weixin-bridge.mjs:90-121` 32 行 `HELP_TEXT` 硬编码在桥接类文件里，可移到独立文案模块。
4. `connection-error.mjs:131-152` 的 `describe(cause, context, evidence)` 用对象解构层层传递 5 个上下文，可读性一般。
5. `config-store.mjs`/`state-store.mjs` 各自实现了一遍「写队列 + 临时文件 + rename」（`config-store.mjs:169-191` vs `state-store.mjs:280-290`），可抽公共原子写；**但两边语义不同（一个有 mutator，一个直接落 snapshot），合并未必划算**。
6. 注释只有中文，未按仓库 `AGENTS.md` 要求中英双语。
7. `publicAttempt`（`weixin-controller.mjs:40-53`）大量 `...(cond ? {k:v} : {})` 展开，可读性一般。
8. `weixin-api.mjs:40-48` 的 `WeixinApiError` 与 `connection-error.mjs:98-105` 的 `weixinStageError` 两套错误构造并存（一条 `code` 链上出现两种错误类型），命名上可统一——**这条接近真问题但只影响可读性，暂列此处**。

---

## 未验证

以下内容本次未取证，不作为上述任何结论的依据：

1. `~/.dsh/integrations/dsh-weixin/` 下现有 `config.json`/`state.json`/`accounts/*` 的真实内容与规模（按纪律未读取 `~/.dsh`）。因此「第 5 刀迁移成本」的具体数字未验证。
2. `weixin-bridge.mjs` 与 `TextHarnessBridge`（`src/channels/shared/text-harness-bridge.mjs`，2100+ 行）之间的功能重复比例未逐行比对；仅确认微信不继承它。
3. 新实现 `plugins/im/` 下除 `core/src/contract.ts` 外的其余文件（`router.ts`/`bindings.ts`/`store.ts`/`tool`/`wechat` provider）未阅读；本文对新契约的理解仅基于 `contract.ts` 与设计文档。
4. `plugin-src/host/channels/shared/startup.mjs` 的 `installProductionChannel` 如何消费 `{controller, deliveryAdapter, ready, close}`（`production.mjs:236-256`）未逐行核对，因此第 1 刀的「影响面」可能被低估。
5. 现有测试（`test/channels/weixin/*.test.mjs`）对这些行为的覆盖情况未逐一看；第 2、6 刀的回归风险可能低于或高于本文估计。
6. `weixin-controller.mjs:429-501` 的紧循环在真实网络下是否真会忙等，取决于 iLink 服务端在 `wait` 状态是否阻塞长轮询；本文只确认「客户端没有 sleep」这一事实，服务端行为未验证。
