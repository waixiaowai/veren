# MCP 管理与聚合开源项目调研

> 调研日期：2026-11-05 ｜ 数据口径：GitHub API（星数、语言、许可证、最近推送）+ 各仓库 README 原文取证
> 配套英文版：[mcp-management-survey.md](./mcp-management-survey.md)

## 1. 调研说明

**范围**：围绕「MCP server 的管理与聚合」收集开源项目——把多个 MCP server 汇到单一端点的网关/聚合器、带控制台的管理平台、registry/目录服务、本地轻量代理。纯 LLM 网关（如 LiteLLM）、纯 MCP server 实现、纯客户端框架不在主线，仅作周边速览。

**方法**：GitHub 搜索 6 组关键词（gateway/aggregator/hub/manager/registry/proxy aggregate）取星数前列 + `awesome-mcp-gateways` 清单交叉核对；对 27 个候选取元数据，对头部 16 个项目逐个抓 README 深挖。

**一句话结论**：这个赛道已经分层成熟——上游有官方 registry 定元数据标准（server.json），中游有企业治理平台（ToolHive/obot）和基础设施网关（agentgateway），下游有自托管控制台（MCPHub/Unla）和本地轻量代理（docker mcp / mcpproxy-go）；「聚合」已从简单合并工具列表进化出智能路由、语义工具发现、工具检疫、vMCP 编排等多种形态。

## 2. 全景地图

```
┌─ 元数据层（registry/目录，只做发现不做流量）
│   modelcontextprotocol/registry（官方）★7438
│   agentic-community/mcp-gateway-registry ★1038（registry+网关一体）
│   pathintegral-institute/mcpm.sh ★1022（CLI 包管理器+registry）
├─ 基础设施层（流量网关，k8s/安全/协议）
│   agentgateway ★5946（LF，Rust）
│   microsoft/mcp-gateway ★907（C#，Azure/k8s）
│   pomerium ★5089（身份感知访问代理）
├─ 平台层（自托管管理平台，控制台+多租户）
│   IBM/mcp-context-forge ★4755 ｜ MCPHub ★2632 ｜ MetaMCP ★2752
│   ToolHive ★2325（+K8s Operator）｜ Unla ★2252 ｜ obot ★1162
├─ 本地层（个人/单机聚合）
│   docker/mcp-gateway ★1625 ｜ mcpproxy-go ★407 ｜ 1mcp ★529
│   tbxark/mcp-proxy ★742 ｜ magg ★143 ｜ FLUJO ★673
└─ 周边（托管平台/LLM 网关带 MCP/连接器/目录站）
    Klavis ★5829 ｜ bifrost ★9377 ｜ open-connector ★6185 ｜ 53AIHub ★4335
```

## 3. 自托管 MCP 管理平台（深挖）

### 3.1 samanhappy/mcphub — 开箱即用的控制平面

| 项 | 值 |
|---|---|
| Stars / 语言 / 许可证 | 2632 / TypeScript / Apache-2.0 |
| 活跃度 | 极活跃（2026-11-03 仍有推送，仅 8 个 open issues） |
| 部署 | Docker 单命令（latest / latest-full 两档镜像）、Node ≥22 + pnpm 源码、Railway/RepoCloud |

- **定位**：自托管 MCP 网关 + 控制平面，「Connect once, expose everywhere」，面向 Claude Code、Cursor、Cherry Studio、OpenWebUI 等客户端。
- **聚合机制**：路径路由模型——`/mcp`（全部）、`/mcp/{group}`（分组）、`/mcp/{server}`（单服）、`/mcp/$smart`（智能路由），支持 server 别名。招牌 **Smart Routing**：PostgreSQL + pgvector 向量语义搜索，按任务动态挑选工具而非全量暴露。配置热更新（不停机增删改 server），可控制各 server/group 的 Tool/Prompt/Resource 暴露与可见性。无工具改名去重机制。
- **管理面**：React Web Dashboard、admin + 多用户、**per-user credentials**（个人密钥绑定共享 server，加密存储、stdio 运行时隔离）、OAuth 2.0 双模式（client + 内置 server）+ GitHub/Google 社交登录（Better Auth）、端点默认强制 Bearer、活动追踪/请求日志/健康检查、工具结果压缩、PostgreSQL 多副本（session affinity）、CLI 与 headless 模式。细粒度 RBAC/审计引导到商业版。
- **协议**：下游 stdio / SSE / Streamable HTTP 全支持；上游统一暴露 HTTP 端点——stdio 本地 server 被转换为远程端点是它的核心能力。
- **局限**：Database Mode 凭证加密 key 丢失不可恢复；所有 stdio server 同容器运行、隔离弱于每 server 独立容器；K8s/HA/审计/OIDC 在商业「Production Support」里。

### 3.2 metatool-ai/metamcp — 聚合抽象最丰富，但维护已放缓

| 项 | 值 |
|---|---|
| Stars / 语言 / 许可证 | 2752 / TypeScript / MIT |
| 活跃度 | **停滞风险**（最近推送 2026-06-22，作者声明放缓维护、只合并社区 PR；社区 fork：Umbrella-IT-Group/metamcp） |
| 部署 | Docker Compose（捆绑 Postgres）、GHCR 镜像、Dev Containers |

- **定位**：把多个 MCP server 动态聚合为单一 MCP server 的代理/编排/中间件/网关，「Aggregator, Orchestrator, Middleware, Gateway in one docker」。
- **聚合机制**：**Namespace → Endpoint 两级模型**——server 编组进 namespace，endpoint 绑定 namespace 输出统一端点，可一键切换指向。聚合时遍历各 server 的 `list_tools` 合并；**server 级与工具级开关**；**Tool Overrides**（按 namespace 改写工具 name/title/description、注入 annotations 如 `readOnlyHint`，与上游元数据合并）；namespace 级可插拔 **Middleware**（内置「过滤失活工具」优化 LLM 上下文）；endpoint/user 两级令牌桶限流（单机内存，集群不共享）。
- **管理面**：Web UI（namespace/endpoint/工具覆写管理 + 内置带保存配置的 Inspector）；API Key、MCP OAuth（2025-06-18 spec）、OIDC SSO（Auth0/Keycloak/Azure AD/Google/Okta，PKCE，Better Auth）；多租户（私有/公共资源范围）；无 registry 市场、无细粒度 RBAC、无独立审计。
- **协议**：下游支持 stdio；上游端点仅远程（**SSE / Streamable HTTP / OpenAPI**）——OpenAPI 暴露是其独有卖点（供 Open WebUI 等非 MCP 客户端）；Claude Desktop 等 stdio-only 客户端需自配 mcp-proxy 桥接。
- **局限**：维护放缓是最大风险；冷启动慢需自定义 Dockerfile 预装依赖；限流计数不跨集群共享。

### 3.3 stacklok/toolhive — 安全与生产化最完整（公司主导）

| 项 | 值 |
|---|---|
| Stars / 语言 / 许可证 | 2325 / Go / Apache-2.0 |
| 活跃度 | 极活跃（2026-11-04，公司专职团队；415 个 open issues 积压） |
| 部署 | Go 单二进制 + Docker/Podman 跑各 server；**K8s Operator**（MCPServer/Registry CRD）；toolhive-studio 桌面应用 |

- **定位**：企业级 MCP 平台，Gateway + Registry Server + Runtime 三组件，以容器隔离和安全策略为核心。
- **聚合机制**：Gateway 侧 **Virtual MCP**——用确定性工作流引擎把多个工具编排成一个虚拟 MCP server；工具过滤与描述定制降低 token 消耗（MCP Optimizer 语义工具搜索号称省 85% token）；Registry 按角色/场景分组。与 MetaMCP 的 namespace 相比偏「编排 + 过滤优化」而非简单合并。
- **管理面**：三者中覆盖最完整——toolhive-studio 桌面 UI + `thv` CLI；独立 **Registry Server**（集成官方 MCP registry、自定义 server、**来源验证与签名**）；IdP 集成 OIDC/OAuth SSO；按请求访问策略；**审计日志**；OpenTelemetry 追踪 + Prometheus 指标；加密 secrets 管理；容器网络隔离（最小权限文件、不落本地凭证）。
- **协议**：下游 `thv run --transport` 支持 stdio / SSE / streamable-http；stdio server 经内置 proxy 自动转 **streamable-http（默认）**，SSE proxy 模式弃用中；`thv run <URL>` 代理远程 server，带 `--remote-auth`（OAuth/OIDC、RFC 7591 动态客户端注册、PKCE）。
- **局限**：组件分散在 5 个仓库（toolhive / studio / registry-server / catalog / docs），概念多上手陡；开源版与 Stacklok Enterprise 有功能边界；没有轻量 namespace 式一键合并。

### 3.4 IBM/mcp-context-forge — 功能最全的应用级平台（也最重）

| 项 | 值 |
|---|---|
| Stars / 语言 / 许可证 | 4755 / Python / Apache-2.0 |
| 活跃度 | 高频活跃（2026-11 仍密集提交；7000+ 测试、40+ 插件；1000+ open issues） |
| 部署 | PyPI（uvx/pip）、Docker Compose 全栈（PostgreSQL 55+ 表 + Redis + Nginx）、Helm（HPA 自动扩缩）；Python ≥3.11 |

- **定位**：开源 MCP registry + 代理（前身 mcpgateway），把任意 MCP server、A2A agent、REST/gRPC API 联邦成单一统一端点。
- **聚合机制**：核心概念 **Virtual Server**——注册多个 gateway（`/gateways`）→ 聚合工具目录（`/tools`）→ 把任意工具捆成带 UUID 的虚拟 server（`/servers/{uuid}/mcp`）暴露；REST-to-MCP 适配（自动 JSON Schema 提取）、gRPC 反射式翻译、A2A 集成、legacy API 虚拟化；跨集群联邦靠 Redis 后端。
- **管理面**：内置 Admin UI（HTMX+Alpine，实时日志）+ 独立容器化新版 Web UI；JWT/Basic/自定义鉴权、RBAC、限流、重试、SSRF 防护；OTel（Phoenix/Jaeger/Zipkin/Datadog）+ Prometheus/Grafana。
- **协议**：上游 HTTP/JSON-RPC/WebSocket/SSE/Streamable HTTP；stdio 靠 `mcpgateway.translate` 转 SSE/HTTP；**MCP↔REST↔gRPC 双向转换 + A2A**，是所有项目里协议面最宽的。
- **局限**：强制 `JWT_SECRET_KEY`/`AUTH_ENCRYPTION_SECRET` 否则不启，上手门槛高；本地 compose 构建依赖 CI 产出 wheel、易失败；arm64 生产不支持（Apple Silicon 需 Rosetta）；Postgres+Redis 组件重。

### 3.5 AmoyLab/Unla — 轻量网关，API→MCP 零侵入转换

| 项 | 值 |
|---|---|
| Stars / 语言 / 许可证 | 2252 / Go 后端 + 内置 TS Web UI / MIT |
| 活跃度 | 活跃（2026-10-20），迭代极快、兼容性不承诺 |
| 部署 | Docker allinone 镜像、Kubernetes/Helm、多副本 |

- **定位**：轻量高可用 MCP 网关，零代码把现有 MCP server 和 REST API 转成 MCP 端点。
- **聚合机制**：YAML 配置驱动，两种模式——REST API→MCP 转换 + MCP 服务反向代理；配置热加载、多副本同步（OS 信号/HTTP/Redis PubSub）；多租户、持久可恢复会话；server 分组聚合仍在 roadmap。
- **管理面**：内置 Web UI（配置管理 + MCP Chat 测试页）；配置持久化 Disk/SQLite/PostgreSQL/MySQL，带版本控制。
- **协议**：对外 SSE + Streamable HTTP；上游可接 REST API 与 MCP 服务；gRPC/WebSocket 转换规划中。
- **局限**：核心聚合（server 分组）能力尚未完成；快速迭代无兼容承诺。

### 3.6 obot-platform/obot — 全栈 AI 治理平台（vMCP + Git 目录）

| 项 | 值 |
|---|---|
| Stars / 语言 / 许可证 | 1162 / Go / MIT（Community/Enterprise 同一代码，license key 区分） |
| 活跃度 | 活跃（2026-11-04） |
| 部署 | 评估单条 `docker run`（挂 docker.sock）；生产 K8s + 外部 PostgreSQL |

- **定位**：企业级开源 AI 治理平台，统一管理 MCP server、模型、agent 客户端、技能与审计。
- **聚合/分发机制**：核心 **vMCP**——把一个或多个 catalog 中的 MCP server 组合挂到单一端点后，组件可 **pin 到目录快照**，目录变更需显式升级才生效；**Git-backed catalogs**（从 GitHub/GitLab/Bitbucket 仓库索引）；对外同时暴露**标准 MCP Registry API**；Obot CLI 搜索/安装；**MCP tunnels** 让内网远程 server 出站连接免开端口。
- **管理面**：完整 Web UI（英/日/韩/简中）；IdP 认证 + Okta SCIM 用户组同步；平台角色 + 按 IdP 组细粒度权限；集中管理 MCP OAuth、用户/共享凭据、K8s secret 绑定；MCP/webhook/凭据过滤器可检视、拒绝或改写请求响应；跨网关关联审计日志可导出。
- **协议**：MCP 网关单入口；可托管 npx/uvx/容器化 server（Docker/K8s workload）；OpenAPI schema 一键转 MCP server；LLM 网关（OpenAI/Anthropic/Bedrock/Azure 兼容）。
- **局限**：企业能力受商业 license 约束；组件庞大（双网关+注册表+CLI+Sentry），轻量场景过重。

## 4. 基础设施级网关（深挖）

### 4.1 agentgateway/agentgateway — agentic 版 Envoy（Linux Foundation）

| 项 | 值 |
|---|---|
| Stars / 语言 / 许可证 | 5946 / Rust / Apache-2.0 |
| 活跃度 | 极活跃（2026-11-05；社区例会 + Discord；README 自述 active development） |
| 部署 | standalone 单二进制（flat YAML）或 K8s 模式（内置 controller + Gateway API CRD） |

- **定位**：基于 MCP & A2A 构建的连接代理，为 agent-to-LLM / agent-to-tool / agent-to-agent 流量提供安全、可观测与治理。
- **聚合机制**：MCP Gateway 做 **tool federation**——listener 绑定多个 MCP target，支持单端口多 server、分路径、**virtual MCP 合并**；同时是 LLM Gateway（OpenAI 兼容路由 OpenAI/Anthropic/Gemini/Bedrock，含预算/花费控制、负载均衡、failover）和 A2A Gateway（能力发现、模态协商）；Inference Routing 支持 K8s Inference Gateway 扩展（按 GPU/KV cache/LoRA/队列深度调度）。
- **管理面**：JWT/API key/OAuth；**CEL 策略引擎**细粒度 RBAC；限流、TLS；多层 Guardrails（regex、OpenAI moderation、Bedrock Guardrails、Model Armor、webhook）；OTel 全套；内置 UI（agent/topology 可视化 + playground）。
- **协议**：下游 MCP（stdio/HTTP/SSE/Streamable 四种传输）、A2A、LLM provider API、普通 HTTP；单一数据面统一三类流量。
- **局限**：仍在快速开发；standalone 与 k8s 两套配置模型学习成本；无内建多用户 registry/团队体系；Rust 定制门槛高。

### 4.2 microsoft/mcp-gateway — Azure 系 k8s 生命周期管理

| 项 | 值 |
|---|---|
| Stars / 语言 / 许可证 | 907 / C# / MIT |
| 活跃度 | 活跃（2026-11-04；仅 15 open issues） |
| 部署 | .NET 8，K8s 原生（StatefulSet + headless service），Azure Bicep/ARM 一键部署 |

- **定位**：MCP server 的反向代理与管理层（control + data plane），在 K8s 做 MCP server 的会话感知路由、鉴权与生命周期管理——像「serverless for MCP」。
- **聚合机制**：两种路由——(1) Adapter 路由：每个 server 一个 `/adapters/{name}/mcp` 端点；(2) **Tool Gateway Router**：一个本身是 MCP server 的路由器（`/mcp`），按注册的 tool definition 动态转发 `tools/call`，多实例无会话亲和。**无虚拟 server 合并语义**。另有 Agents/Sessions（Preview，单副本）把 LLM agent 跑在注册工具上。
- **管理面**：REST 管理 API（adapters/tools/agents CRUD、pod 日志）+ React 管理门户（浏览器内 JSON-RPC 测试台）；Azure Entra ID + 应用角色 RBAC（`mcp.admin`）；元数据 Redis（本地）或 Cosmos DB（云）。
- **协议**：**要求 MCP `2026-07-28` 客户端**（破坏性变更，不支持 legacy 初始化/传输会话/降级）；上游只面向 Streamable HTTP，不做 stdio/SSE 托管转换，无 A2A/REST 转换。
- **局限**：只追最新协议版本，旧客户端直接不可用；深度绑定 Azure；聚合能力三者最弱。

### 4.3 周边基础设施

- **pomerium/pomerium**（5089★，Go，Apache-2.0，活跃）：身份与上下文感知访问代理，MCP 支持表现为「认证 + 访问策略 + per-tool 控制」的入口层，不聚合工具，管准入。
- **lasso-security/mcp-gateway**（397★，Python，MIT，2026-01 后停滞）：插件式安全网关，编排其他 MCP 并注入企业级安全插件（内容过滤/防护）。

## 5. Registry 与目录（深挖）

### 5.1 modelcontextprotocol/registry — 官方社区 registry（元数据标准）

| 项 | 值 |
|---|---|
| Stars / 语言 / 许可证 | 7438 / Go / MIT → Apache-2.0 迁移中 |
| 活跃度 | 极活跃；2025-09 preview 上线，2025-10 起 **API v0.1 冻结**（仍 preview，可能有 breaking） |
| 部署 | Go + PostgreSQL；官方镜像 `ghcr.io/modelcontextprotocol/registry:latest`（自带 PG）；自托管实例可作私有 registry 起点 |

- **定位**：「MCP server 的应用商店」——全球唯一权威公开元数据目录（registry.modelcontextprotocol.io），**纯目录不代理流量**。
- **分发机制**：REST API `GET /v0/servers` 游标分页，条目即官方 **server.json schema**（name/version/remotes/packages，`_meta` 内嵌官方状态 active/publishedAt/isLatest）；发布走 `mcp-publisher` CLI（不走 PR）；**命名空间所有权验证**——`io.github.<user>/...` 需 GitHub OAuth 或 Actions OIDC，`<domain>/...` 需 DNS/HTTP challenge；定期从 GitHub seed 导入。
- **管理面**：无市场 Web UI；无 RBAC/租户/审批/审计——读公开、写需验证所有权。
- **价值定位**：企业不是「部署它来治理」，而是把**兼容它的 API/server.json 作为自家方案的对外接口**（obot 与 agentic-community 均已支持或联邦该规范）。

### 5.2 agentic-community/mcp-gateway-registry — 企业私有 registry+网关参考实现（AWS 系）

| 项 | 值 |
|---|---|
| Stars / 语言 / 许可证 | 1038 / Python / Apache-2.0 |
| 活跃度 | 极活跃（已至 v1.36.0，每日推送） |
| 部署 | Docker Compose、Amazon ECS + Terraform、EKS + Helm；依赖 MongoDB/Keycloak/nginx |

- **定位**：企业级 MCP Gateway & Registry 一体化控制平面（脱胎于 AWS 开源项目），扩展为通用 AI 资产注册表——MCP server、A2A agent、SKILL.md 技能、自定义实体四类资产统一注册/发现/治理。
- **聚合机制**：nginx 数据面（TLS、鉴权子请求、路由）+ FastAPI 控制面；**Virtual MCP Server** 聚合多后端工具 + per-tool 访问控制；语义+词法搜索运行时动态工具发现；**外部 registry 联邦**（拉取官方 MCP Registry、AWS Agent Registry）。
- **管理面**：Web UI + REST API/CLI/MCP 原生接口（mcpgw server）；OAuth2/OIDC 对接 Keycloak/Entra/Okta/Auth0/Cognito；注册时安全扫描 + **fail-closed 准入门禁**；**per-user egress auth**（3LO/OBO，网关托管第三方 SaaS 令牌，RFC 8693 token exchange）；全量可归因审计（凭据脱敏）+ OTel。
- **局限**：组件栈重（nginx+Keycloak+MongoDB+FastAPI）；深度绑定 AWS；A2A 默认 P2P 绕过网关；默认开匿名遥测（`MCP_TELEMETRY_DISABLED=1` 关）。

### 5.3 pathintegral-institute/mcpm.sh — MCP 的「包管理器」CLI

1022★，Python，MIT，活跃（2026-11-04）。定位是 MCP server 的包管理器：搜索/安装/组织/分享。全局安装 + **profile（虚拟标签）分组**；`mcpm profile run --http` 把一组 server 合并为一个 HTTP 端点；`mcpm share` 安全隧道公开分享。客户端集成覆盖最广（Claude Desktop/Cursor/Windsurf/VSCode 等十余种的配置读写与启停开关），有用量分析与 server 更新管理（git/npm/二进制）。局限：本质偏客户端配置管理器，网关侧缺认证/多租户/工具过滤。

## 6. 本地与轻量聚合（深挖）

### 6.1 docker/mcp-gateway — Docker 官方 Toolkit 底座

1625★，Go，MIT，活跃。单一 Gateway 暴露所有容器化 MCP server；**profile 分组** + 四种 catalog 来源（`catalog://`、`docker://`、MCP Registry、`file://`），catalog 以 **OCI 镜像**分发；`docker mcp` CLI（profile/catalog/tools/client/secret/oauth 子命令）、工具级 allowlist、内置 OAuth 流程；Docker Desktop 4.59+ 插件或独立运行。亮点：容器隔离 + secrets 管理 + OCI catalog 分发，工程化最完整；局限：深度绑定 Docker 生态。

### 6.2 smart-mcp-proxy/mcpproxy-go — 安全检疫 + BM25 按需工具发现

407★，Go，MIT，活跃（2026-11-04）。单二进制本地代理，三种路由模式：**retrieve_tools**（BM25 全文索引，agent 用自然语言按需检索工具）、direct（`server__tool` 命名全量暴露）、code_execution（沙箱 VM 内 JS 链式编排）；可突破 Cursor 40-tool / OpenAI 128-function 上限。管理面最安全：新 server **强制隔离检疫 + 人工审批**、工具定义变更再审、可插拔扫描器（Snyk/Semgrep/Trivy，SARIF 归一）、活动审计、读/写/破坏性三级授权；Web UI + CLI + macOS 菜单栏 app。上游 stdio+HTTP，对客户端 streamable HTTP。局限：小工具集下 retrieve_tools 模式代理自身菜单反而更大（文档如实承认有盈亏平衡点）。

### 6.3 1mcp-app/agent — 面向 agent 循环的渐进式发现

529★，TypeScript，Apache-2.0，活跃。`1mcp serve` 聚合多 server：静态 server 启动加载 + **模板 server 按客户端/会话上下文动态物化**；presets + 过滤器；跨 server instruction 聚合；可选 lazy loading 保持稳定工具面。CLI 模式走 instructions→inspect→run 三步渐进发现，省 context；npm 全局安装、常驻 serve 进程；另有 stdio proxy 兼容模式；遥测默认开可关。局限：三条接入路径（CLI/proxy/direct）概念较多。

### 6.4 tbxark/mcp-proxy — 极简配置即部署

742★，Go，MIT，中等活跃（2026-09-15）。单个 JSON 配置声明全部上游（v2 schema），聚合 tools/prompts/resources 到统一端点；每上游 **toolFilter**（allow/block）+ 独立 authTokens 路由级鉴权；上游 stdio/SSE/streamable-http 三类，对外 SSE（默认）或 streamable-http；**可代下游做交互式 OAuth 并持有/刷新 token**（如 Notion）；Docker 内置 npx/uvx。局限：完全静态，改配置需重启，无管理面。

### 6.5 sitbon/magg — LLM 自治的 meta-MCP server

143★，Python，**AGPL-3.0**（商用注意）。把管理动作做成 MCP 工具交给模型自己：`magg_add/remove/enable/disable` 动态增删 server，聚合工具带前缀命名空间；**kit** 打包成组加载/卸载；smart configure 借 MCP sampling 从 URL 智能生成配置；config.json 持久化 + 热重载；stdio/HTTP/hybrid 三模式 + ProxyMCP 自代理工具；带 mbro CLI。亮点：「LLM 自主扩展能力」的自服务范式独树一帜；局限：AGPL 传染、社区最小。

### 6.6 其他轻量项目速览

- **mario-andreschak/FLUJO**（673★，TS，MIT，活跃）：本地优先 MCP 客户端 + 可视化 agent 编排，把 MCP server 重新经 Streamable HTTP 暴露并带 Web UI。
- **vtxf/mcp-all-in-one**（70★，TS，2025-11 后停滞）：多服务合一聚合器，小而全但已不活跃。
- **mark3labs/mcphost**（1591★，Go，MIT，**2026-04 已归档**）：CLI host，曾是最流行的本地 MCP 宿主之一，勿再选型。

## 7. 周边生态速览

| 项目 | Stars | 语言 | 许可证 | 一句话 |
|---|---|---|---|---|
| maximhq/bifrost | 9377 | Go | Apache-2.0 | LLM 网关兼 MCP 网关/agent 网关，OpenAI 兼容单端点 |
| oomol-lab/open-connector | 6185 | TS | 自定义 | 1500+ SaaS 鉴权连接器，经 SDK/CLI/MCP/HTTP/OpenAPI 供 agent 用 |
| Klavis-AI/klavis | 5829 | Python | Apache-2.0 | MCP 集成托管平台（大规模可靠工具调用；2026-06 后推送变缓） |
| 53AI/53AIHub | 4335 | Go | 自定义 | AI 门户+知识库：管理企业 agent/prompt/MCP 工具 |
| decocms/studio | 415 | TS | MIT | MCP 控制平面：连接工具、token/成本追踪（MCP Mesh） |
| Nexus-Router/nexus | 438 | Rust | MPL-2.0 | 「插上所有 MCP server 和 LLM」路由器（2026-03 后停滞） |
| e2b-dev/awesome-mcp-gateways | — | — | — | 本赛道最全清单（收录门槛 200★+2 贡献者） |

## 8. 横向对比总表

| 项目 | 聚合模型 | 管理面强度 | 协议转换 | 多租户/鉴权 | 部署重量 | 维护状态 |
|---|---|---|---|---|---|---|
| MCPHub | 路径路由 + $smart 语义路由 | ★★★★（Dashboard/用户/per-user 凭证） | stdio→HTTP/SSE | 用户体系 + OAuth/Bearer | 轻（单容器） | 极活跃 |
| MetaMCP | Namespace→Endpoint + 工具覆写 + 中间件 | ★★★（Web UI/SSO/限流） | MCP→SSE/HTTP/**OpenAPI** | API key/OIDC/多租户 | 中（Compose+PG） | **停滞风险** |
| ToolHive | Virtual MCP（工作流编排）+ 过滤 | ★★★★★（registry/签名/审计/OTel） | stdio→streamable-http | OIDC/按请求策略 | 重（Operator/桌面/多仓） | 极活跃（公司） |
| ContextForge | Virtual Server + 全协议联邦 | ★★★★（Admin UI/RBAC/OTel） | MCP↔REST↔gRPC↔A2A | JWT/RBAC | 重（PG+Redis+Nginx） | 活跃 |
| Unla | YAML 反代 + API→MCP 转换 | ★★★（Web UI/配置版本化） | REST→MCP | 多租户 | 轻 | 活跃 |
| obot | vMCP + Git catalog pin/升级 | ★★★★★（SCIM/过滤器/审计） | OpenAPI→MCP + LLM 网关 | IdP+RBAC 完整 | 重 | 活跃 |
| agentgateway | tool federation + virtual MCP | ★★★（CEL 策略/UI/playground） | MCP/A2A/LLM 三合一 | JWT/OAuth/CEL | 中（单二进制或 k8s） | 极活跃（LF） |
| ms/mcp-gateway | Adapter 路由 + Tool Router | ★★★（REST API/门户） | 无（仅 Streamable HTTP） | Entra ID RBAC | 重（Azure/k8s） | 活跃 |
| 官方 registry | 纯元数据目录 | ★（无 UI/RBAC） | 不适用 | 命名空间所有权验证 | 轻 | 极活跃 |
| agentic-community | Virtual MCP + registry 联邦 | ★★★★★（扫描/egress/审计） | MCP/A2A/Skills/REST | OIDC 全家桶 | 重（Keycloak/Mongo） | 极活跃 |
| docker/mcp-gateway | profile + OCI catalog | ★★（CLI/Desktop UI） | stdio/SSE/streaming | OAuth 内置 | 轻（需 Docker） | 活跃 |
| mcpproxy-go | BM25 检索/direct/沙箱编排 | ★★★★（检疫/审批/扫描/审计） | stdio→streamable HTTP | 工具三级授权 | 轻 | 活跃 |
| 1mcp | 静态+模板动态物化 | ★★（CLI） | streamable HTTP + stdio proxy | — | 轻 | 活跃 |
| mcpm.sh | profile 分组合并端点 | ★★（CLI/registry） | stdio→HTTP 弱转换 | — | 轻 | 活跃 |
| tbxark/mcp-proxy | 单配置聚合 | ★（纯配置） | stdio/SSE/HTTP + 代持 OAuth | 每上游 token | 极轻 | 中等 |
| magg | LLM 自治动态增删 | ★（工具即管理） | stdio/HTTP/hybrid | 可选 JWT | 轻 | 一般 |

## 9. 选型决策树

- **个人本机、多客户端配置统一管理** → mcpm.sh（配置分发最广）/ docker mcp（已在用 Docker Desktop）
- **个人本机、对抗工具膨胀与恶意 server** → mcpproxy-go（BM25 检索 + 检疫审批）
- **小团队自托管，要开箱即用控制台** → **MCPHub**（最活跃最省心）或 Unla（要 API→MCP 转换）
- **复杂工具编排、中间件、异构客户端（含 OpenAPI 暴露）** → MetaMCP（接受维护风险）或 ToolHive Virtual MCP
- **企业 K8s + 安全合规（审计/签名/SSO）** → **ToolHive**（Operator + 审计）或 agentgateway（流量层治理）
- **端到端企业治理（MCP+模型+设备+审计）** → obot（接受商业 license 边界）
- **自建私有 registry + 网关、AWS 生态** → agentic-community/mcp-gateway-registry
- **全协议联邦（REST/gRPC/A2A 转 MCP）** → IBM ContextForge
- **元数据标准对接（对外接口）** → 对齐官方 registry 的 server.json schema + v0 API
- **探索 agent 自治管理范式** → magg（注意 AGPL）/ 1mcp
- **深度绑定 Azure、只追最新 MCP 协议** → microsoft/mcp-gateway

## 10. 对本工作区（DSH 生态）的启示

1. **server.json 是值得对齐的标准**：DSH 已有 market（registry index.json + 插件包分发），官方 registry 的 server.json schema + 命名空间所有权验证（GitHub OAuth/DNS challenge）是「发布鉴权」一环的可借鉴现成设计——DSH market 目前没有发布者所有权验证这一层。
2. **「聚合」的价值已被反复验证**：工具全量暴露 → 按需检索（MCPHub $smart / mcpproxy BM25 / ToolHive Optimizer 85% token 节省）是共同进化方向；DSH 会话已按页面作用域挂工具（task-workbench list/detail 互斥），同一思路。
3. **per-user credentials 是共享 server 的刚需**：MCPHub 的个人密钥绑定共享 server + stdio 运行时隔离、agentic-community 的 egress auth（网关代持第三方 SaaS 令牌），对 DSH 多会话共享插件凭据是直接参考。
4. **pin/upgrade 的目录快照模型**：obot 的 vMCP 把组件 pin 到 catalog 快照、显式升级才生效——比「装了就自动变」的模型更可控，对 DSH 组合包（bundle）版本策略有参考价值。
5. **工具覆写层**：MetaMCP 的 Tool Overrides（改 description/注入 readOnlyHint annotations）说明「工具元数据是可治理数据」；DSH 的工具描述门禁（crawler 那两条修复）已在做同类事，可以把覆写机制显式化。
6. **风险清单**：MetaMCP 的维护停滞证明单维护者风险真实存在——选型引入外部 MCP 组件时优先公司/基金会背书项目（ToolHive/agentgateway/obot）。

## 11. 资料来源

- 各仓库 README（GitHub API raw，2026-11-05 抓取）与仓库元数据 API
- [e2b-dev/awesome-mcp-gateways](https://github.com/e2b-dev/awesome-mcp-gateways)（收录门槛 200★+2 贡献者的清单）
- [agentgateway.dev 文档](https://agentgateway.dev/docs/standalone/latest/documentation/mcp/about.md)
- [ToolHive CLI 参考](https://docs.stacklok.com/toolhive/reference/cli/thv_run)
- [Scalekit: Best Open Source MCP Gateways in 2026](https://www.scalekit.com/blog/best-open-source-mcp-gateways)
- [Composio: 10 Best MCP Gateways for Developers](https://composio.dev/content/best-mcp-gateway-for-developers)
- [Lunar.dev: Best Open Source MCP Gateways](https://www.lunar.dev/post/the-best-open-source-mcp-gateways-in-2026)
- [Manveer's Substack: Best MCP Gateways Hands-On Comparison](https://manveerc.substack.com/p/best-mcp-gateways)
