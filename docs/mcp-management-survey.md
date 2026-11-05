# Survey: Open-Source MCP Management & Aggregation Projects

> Survey date: 2026-11-05 ｜ Data: GitHub API (stars, language, license, last push) + README deep-dives
> Chinese version: [mcp-management-survey.cn.md](./mcp-management-survey.cn.md)

## 1. Scope & Method

**Scope**: open-source projects around "managing and aggregating MCP servers" — gateways/aggregators that expose many MCP servers behind one endpoint, self-hosted management platforms with consoles, registries/directories, and lightweight local proxies. Pure LLM gateways, pure MCP server implementations and client-side frameworks are peripheral only.

**Method**: GitHub search across 6 keyword groups (gateway / aggregator / hub / manager / registry / proxy aggregate), cross-checked with the `awesome-mcp-gateways` list; metadata collected for 27 candidates, READMEs deep-dived for the top 16.

**TL;DR**: the space is now layered and mature — an official registry defines the metadata standard (server.json), enterprise governance platforms (ToolHive/obot) and infrastructural gateways (agentgateway) sit in the middle, self-hosted consoles (MCPHub/Unla) and lightweight local proxies (docker mcp / mcpproxy-go) at the edge. "Aggregation" has evolved from plain tool-list merging into smart routing, semantic tool discovery, tool quarantine and vMCP orchestration.

## 2. Landscape

```
┌─ Metadata layer (registries/directories: discovery only, no traffic)
│   modelcontextprotocol/registry (official) ★7438
│   agentic-community/mcp-gateway-registry ★1038 (registry + gateway in one)
│   pathintegral-institute/mcpm.sh ★1022 (CLI package manager + registry)
├─ Infrastructure layer (traffic gateways: k8s / security / protocol)
│   agentgateway ★5946 (LF, Rust) ｜ microsoft/mcp-gateway ★907 (C#, Azure/k8s)
│   pomerium ★5089 (identity-aware access proxy)
├─ Platform layer (self-hosted management platforms: console + multi-tenancy)
│   IBM/mcp-context-forge ★4755 ｜ MetaMCP ★2752 ｜ MCPHub ★2632
│   ToolHive ★2325 (+K8s Operator) ｜ Unla ★2252 ｜ obot ★1162
├─ Local layer (personal/single-machine aggregation)
│   docker/mcp-gateway ★1625 ｜ tbxark/mcp-proxy ★742 ｜ 1mcp ★529
│   mcpproxy-go ★407 ｜ FLUJO ★673 ｜ magg ★143
└─ Peripheral (hosted platforms / LLM gateways with MCP / connectors)
    bifrost ★9377 ｜ open-connector ★6185 ｜ Klavis ★5829 ｜ 53AIHub ★4335
```

## 3. Self-Hosted Management Platforms (deep dive)

### 3.1 samanhappy/mcphub — the turnkey control plane

| | |
|---|---|
| Stars / Language / License | 2632 / TypeScript / Apache-2.0 |
| Activity | very active (push 2026-11-03, only 8 open issues) |
| Deploy | single Docker command (latest / latest-full), Node ≥22 + pnpm from source, Railway/RepoCloud |

- **Positioning**: self-hosted MCP gateway + control plane, "Connect once, expose everywhere", serving Claude Code, Cursor, Cherry Studio, OpenWebUI and friends.
- **Aggregation**: path-based routing — `/mcp` (all), `/mcp/{group}`, `/mcp/{server}`, `/mcp/$smart` (smart routing), with server aliases. Signature **Smart Routing**: PostgreSQL + pgvector semantic search picks tools per task instead of exposing everything. Hot config reload; per-server/group control over Tool/Prompt/Resource exposure. No tool renaming/dedup.
- **Management**: React Web Dashboard; admin + multi-user; **per-user credentials** (personal keys bound to shared servers, encrypted, stdio runtime isolation); OAuth 2.0 dual mode (client + built-in server) + GitHub/Google social login (Better Auth); endpoints enforce Bearer by default; activity tracking, request logs, health checks, tool-result compression; PostgreSQL mode with multi-replica (session affinity); CLI & headless mode. Fine-grained RBAC/audit is steered to the paid tier.
- **Protocol**: downstream stdio / SSE / Streamable HTTP; upstream exposes unified HTTP endpoints — converting local stdio servers into remote ones is a core capability.
- **Limitations**: losing `MCPHUB_CREDENTIAL_ENCRYPTION_KEY` means encrypted credentials are unrecoverable; all stdio servers run in one container (weaker isolation than per-server containers); K8s/HA/audit/OIDC live in the commercial "Production Support".

### 3.2 metatool-ai/metamcp — richest aggregation abstractions, maintenance slowing

| | |
|---|---|
| Stars / Language / License | 2752 / TypeScript / MIT |
| Activity | **stagnation risk** (last push 2026-06-22; maintainer publicly moved to merge-only mode; community fork: Umbrella-IT-Group/metamcp) |
| Deploy | Docker Compose (bundled Postgres), GHCR images, Dev Containers |

- **Positioning**: dynamic aggregation of many MCP servers into one, "Aggregator, Orchestrator, Middleware, Gateway in one docker".
- **Aggregation**: **Namespace → Endpoint two-level model** — servers are grouped into namespaces; an endpoint binds a namespace and can switch targets in one click. Tools are merged via each server's `list_tools`; per-server and per-tool toggles; **Tool Overrides** (rewrite name/title/description per namespace, inject annotations like `readOnlyHint`, merged with upstream metadata); pluggable namespace-level **Middleware** (built-in "filter inactive tools" to shrink LLM context); endpoint/user token-bucket rate limits (in-memory, not shared across replicas).
- **Management**: Web UI (namespaces/endpoints/overrides + a stateful built-in Inspector); API keys, MCP OAuth (2025-06-18 spec), OIDC SSO (Auth0/Keycloak/Azure AD/Google/Okta, PKCE, Better Auth); multi-tenancy (private/public resource scopes); no marketplace, no fine-grained RBAC, no standalone audit log.
- **Protocol**: downstream stdio supported; upstream endpoints are remote-only (**SSE / Streamable HTTP / OpenAPI**) — the OpenAPI exposure is unique (for Open WebUI etc.); stdio-only clients like Claude Desktop need a local mcp-proxy bridge.
- **Limitations**: maintenance slowdown is the biggest risk; slow cold start (custom Dockerfile to pre-install deps); rate-limit counters not shared across clusters.

### 3.3 stacklok/toolhive — the most complete security & productionization story

| | |
|---|---|
| Stars / Language / License | 2325 / Go / Apache-2.0 |
| Activity | very active (push 2026-11-04; company-backed team; 415 open issues backlog) |
| Deploy | Go binary + Docker/Podman per server; **K8s Operator** (MCPServer/Registry CRDs); toolhive-studio desktop app |

- **Positioning**: enterprise MCP platform in three components — Gateway, Registry Server, Runtime — with container isolation and security policy at the core (Stacklok).
- **Aggregation**: gateway-side **Virtual MCP** composes multiple tools into one virtual MCP server via a deterministic workflow engine; tool filtering + description customization to cut token usage (MCP Optimizer semantic tool search claims 85% savings); registry grouping by role/scenario. Closer to "orchestration + filtering" than MetaMCP's namespace merging.
- **Management**: the fullest coverage — toolhive-studio desktop UI + `thv` CLI; standalone **Registry Server** (integrates the official MCP registry, custom servers, **source verification & signing**); IdP-integrated OIDC/OAuth SSO; per-request access policies; **audit logs**; OpenTelemetry tracing + Prometheus metrics; encrypted secrets; container network isolation (least-privilege files, no local credential drops).
- **Protocol**: `thv run --transport` supports stdio / SSE / streamable-http; stdio servers are auto-proxied to **streamable-http (default)**, SSE proxy mode deprecated; `thv run <URL>` proxies remote servers with `--remote-auth` (OAuth/OIDC, RFC 7591 dynamic client registration, PKCE).
- **Limitations**: components spread across 5 repos (toolhive / studio / registry-server / catalog / docs) — many concepts, steep ramp; open-core boundary with Stacklok Enterprise; no lightweight namespace-style one-click merge.

### 3.4 IBM/mcp-context-forge — the widest-featured app-level platform (and the heaviest)

| | |
|---|---|
| Stars / Language / License | 4755 / Python / Apache-2.0 |
| Activity | high-frequency active (dense commits through 2026-11; 7000+ tests, 40+ plugins; 1000+ open issues) |
| Deploy | PyPI (uvx/pip), full Docker Compose stack (PostgreSQL 55+ tables + Redis + Nginx), Helm with HPA; Python ≥3.11 |

- **Positioning**: open-source MCP registry + proxy (formerly mcpgateway), federating any MCP servers, A2A agents and REST/gRPC APIs into one unified endpoint.
- **Aggregation**: the **Virtual Server** concept — register gateways (`/gateways`) → aggregated tool catalog (`/tools`) → bundle any tools into a UUID-addressed virtual server (`/servers/{uuid}/mcp`); REST-to-MCP adaptation (auto JSON Schema extraction), gRPC reflection translation, A2A integration, legacy API virtualization; cross-cluster federation via a Redis backend.
- **Management**: built-in Admin UI (HTMX+Alpine, live logs) + a newer containerized Web UI; JWT/Basic/custom auth, RBAC, rate limiting, retries, SSRF protection; OTel (Phoenix/Jaeger/Zipkin/Datadog) + Prometheus/Grafana.
- **Protocol**: upstream HTTP/JSON-RPC/WebSocket/SSE/Streamable HTTP; stdio via `mcpgateway.translate`; **bidirectional MCP↔REST↔gRPC + A2A** — the widest protocol surface of all surveyed projects.
- **Limitations**: refuses to start without `JWT_SECRET_KEY`/`AUTH_ENCRYPTION_SECRET`; local compose builds depend on CI-produced wheels and often fail; arm64 production unsupported (Apple Silicon needs Rosetta or PyPI); heavy (Postgres+Redis).

### 3.5 AmoyLab/Unla — lightweight gateway, zero-code API→MCP conversion

2252★, Go backend + embedded TS Web UI, MIT, active (2026-10-20; fast iteration, no compatibility promises). YAML-driven with two modes: REST API→MCP conversion and MCP reverse proxying; hot config reload; multi-replica sync (OS signal / HTTP / Redis PubSub); multi-tenancy; persistent recoverable sessions; server-group aggregation still on the roadmap. Built-in Web UI (config management + MCP Chat test page); config persisted to Disk/SQLite/PostgreSQL/MySQL with version control. Exposes SSE + Streamable HTTP; gRPC/WebSocket conversion planned. Deploys via all-in-one Docker image, K8s/Helm, multi-replica. Limitation: core aggregation (server grouping) not finished; breakneck iteration.

### 3.6 obot-platform/obot — full-stack AI governance platform (vMCP + Git catalogs)

1162★, Go, MIT (Community/Enterprise share one codebase split by license key), active (2026-11-04). Evaluates with a single `docker run` (docker.sock mounted); production is K8s + external PostgreSQL. Core abstraction **vMCP**: compose one or more catalog MCP servers behind a single endpoint, with components **pinned to catalog snapshots** — catalog changes need an explicit upgrade to take effect. **Git-backed catalogs** (indexed from GitHub/GitLab/Bitbucket); exposes the **standard MCP Registry API** alongside; Obot CLI for search/install; **MCP tunnels** let intranet servers connect outbound without open ports. Full Web UI (en/ja/ko/zh-CN); IdP auth + Okta SCIM sync; platform roles + fine-grained per-IdP-group permissions; centralized MCP OAuth, user/shared credentials, K8s secret binding; MCP/webhook/credential filters can inspect, reject or rewrite requests/responses; correlated, exportable audit logs across gateways. Hosts npx/uvx/containerized servers (Docker/K8s); OpenAPI schema → MCP server one-click; LLM gateway (OpenAI/Anthropic/Bedrock/Azure compatible). Limitations: enterprise features license-gated; heavy component set (two gateways + registry + CLI + Sentry).

## 4. Infrastructure-Level Gateways (deep dive)

### 4.1 agentgateway/agentgateway — the agentic Envoy (Linux Foundation)

5946★, Rust, Apache-2.0, extremely active (2026-11-05; community meetings + Discord; README says "active development"). Runs as a standalone binary (flat YAML) or in Kubernetes mode (built-in controller + Gateway API CRDs). MCP Gateway does **tool federation** — a listener binds multiple MCP targets: single-port multi-server, path-split, or **virtual MCP merge**; it is simultaneously an LLM Gateway (OpenAI-compatible routing to OpenAI/Anthropic/Gemini/Bedrock with budget/spend control, load balancing, failover) and an A2A Gateway (capability discovery, modality negotiation); Inference Routing supports the K8s Inference Gateway extension (GPU/KV-cache/LoRA/queue-depth-aware scheduling). Management: JWT/API key/OAuth; **CEL policy engine** for fine-grained RBAC; rate limits, TLS; layered Guardrails (regex, OpenAI moderation, Bedrock Guardrails, Model Armor, webhooks); full OTel; built-in UI (agent/topology visualization + playground). Protocols: downstream MCP (stdio/HTTP/SSE/Streamable), A2A, LLM provider APIs, plain HTTP — one data plane for all three traffic classes. Limitations: fast-moving development; two config models to learn; no built-in multi-user registry/team system; Rust customization bar.

### 4.2 microsoft/mcp-gateway — Azure-flavored k8s lifecycle management

907★, C#, MIT, active (2026-11-04; only 15 open issues). .NET 8, Kubernetes-native (StatefulSet + headless service), one-click Azure deploy (Bicep/ARM). A reverse proxy + management layer (control + data plane) for session-aware routing, auth and lifecycle of MCP servers in K8s — think "serverless for MCP". Two routing models: (1) Adapter routing — one `/adapters/{name}/mcp` endpoint per server; (2) **Tool Gateway Router** — a router that is itself an MCP server (`/mcp`), dynamically forwarding `tools/call` by registered tool definitions, no session affinity across replicas. **No virtual-server merge semantics**; an Agents/Sessions preview (single replica) runs LLM agents over registered tools. Management: REST admin API (adapters/tools/agents CRUD, pod logs) + React portal with an in-browser JSON-RPC console; Azure Entra ID + app-role RBAC (`mcp.admin`); metadata in Redis (local) or Cosmos DB (cloud). Protocols: **requires MCP `2026-07-28` clients** (breaking — no legacy init, transport sessions, or downgrade); upstream targets Streamable HTTP only; no stdio/SSE hosting, no A2A/REST conversion. Limitations: latest-protocol-only (old clients break); deeply Azure-bound; weakest aggregation of the infra trio.

### 4.3 Peripheral infrastructure

- **pomerium/pomerium** (5089★, Go, Apache-2.0, active): identity- and context-aware access proxy; its MCP story is an admission layer — auth + access policies + per-tool controls. Does not aggregate tools.
- **lasso-security/mcp-gateway** (397★, Python, MIT, stalled since 2026-01): plugin-based security gateway orchestrating MCPs with enterprise guardrail plugins.

## 5. Registries & Directories (deep dive)

### 5.1 modelcontextprotocol/registry — the official community registry (metadata standard)

7438★, Go, MIT → Apache-2.0 migration in progress. Very active; preview since 2025-09, **API v0.1 frozen since 2025-10** (still preview, breaking changes possible). Deploys as Go + PostgreSQL; official image `ghcr.io/modelcontextprotocol/registry:latest` (bring your own PG); self-hosted instances can serve as private-registry starting points. It is "the app store for MCP servers" — the single authoritative public metadata catalog (registry.modelcontextprotocol.io), **pure directory, zero traffic proxying**. Distribution: REST API `GET /v0/servers` with cursor pagination; entries follow the official **server.json schema** (name/version/remotes/packages, `_meta` carrying official status active/publishedAt/isLatest); publishing via the `mcp-publisher` CLI (no PRs); **namespace ownership verification** — `io.github.<user>/...` via GitHub OAuth or Actions OIDC, `<domain>/...` via DNS/HTTP challenge. Management surface: none in the market sense — no UI, RBAC, tenants, approval flow or audit; reads are public, writes require verified ownership. **Strategic value**: you don't deploy it to govern; you make your own solution's external interface **compatible with its API/server.json** (obot and agentic-community already support or federate the spec).

### 5.2 agentic-community/mcp-gateway-registry — the reference enterprise private registry+gateway (AWS lineage)

1038★, Python, Apache-2.0, extremely active (v1.36.0, daily pushes). Deploys via Docker Compose, Amazon ECS + Terraform, or EKS + Helm; depends on MongoDB/Keycloak/nginx. An enterprise MCP Gateway & Registry control plane (born from an AWS open-source project) extended into a general AI-asset registry: MCP servers, A2A agents, SKILL.md skills and admin-defined entities, all registered/discovered/governed together. nginx as the data plane (TLS, auth subrequests, routing) + FastAPI registry as the control plane; **Virtual MCP Server** aggregates multi-backend tools with per-tool access control; semantic + lexical search for runtime tool discovery; **external registry federation** (pulls the official MCP Registry, AWS Agent Registry). Management: Web UI + REST API/CLI/MCP-native interface (mcpgw server); OAuth2/OIDC against Keycloak/Entra/Okta/Auth0/Cognito; security scanning at registration + **fail-closed admission gates**; **per-user egress auth** (3LO/OBO — the gateway holds third-party SaaS tokens, RFC 8693 token exchange); fully attributable audit (credentials redacted) + OTel. Limitations: heavy stack; AWS-bound paths; A2A defaults to P2P bypassing the gateway; anonymous telemetry on by default (`MCP_TELEMETRY_DISABLED=1`).

### 5.3 pathintegral-institute/mcpm.sh — the "package manager" CLI for MCP servers

1022★, Python, MIT, active (2026-11-04). Search/install/organize/share MCP servers; global installs + **profiles (virtual tags)** for grouping; `mcpm profile run --http` merges a group into one HTTP endpoint; `mcpm share` publishes via a secure tunnel. Widest client integration coverage (config read/write + enable/disable toggles for 10+ clients: Claude Desktop, Cursor, Windsurf, VSCode…), usage analytics, server update management (git/npm/binary). Limitation: essentially a client-side config manager; its gateway side lacks auth/tenancy/tool filtering.

## 6. Local & Lightweight Aggregation (deep dive)

### 6.1 docker/mcp-gateway — the official Docker Toolkit base

1625★, Go, MIT, active. One gateway exposes all catalog MCP servers containerized; **profiles** for grouping; four catalog sources (`catalog://`, `docker://`, MCP Registry, `file://`) with catalogs distributed as **OCI images**; `docker mcp` CLI (profile/catalog/tools/client/secret/oauth), tool-level allowlists, built-in OAuth flows; Docker Desktop 4.59+ plugin or standalone. Strength: container isolation + secrets + OCI catalog distribution, the most engineered of the local tier. Limitation: deeply Docker-bound.

### 6.2 smart-mcp-proxy/mcpproxy-go — quarantine + BM25 on-demand tool discovery

407★, Go, MIT, active (2026-11-04). Single-binary local proxy with three routing modes: **retrieve_tools** (BM25 full-text index; agents retrieve tools by natural language on demand), direct (`server__tool` naming, full exposure), code_execution (JS chaining inside a sandboxed VM); breaks past Cursor's 40-tool / OpenAI's 128-function caps. Strongest local security posture: **mandatory quarantine + human approval** for new servers, re-approval on tool-definition changes, pluggable scanners (Snyk/Semgrep/Trivy with SARIF normalization), activity audit, read/write/destructive three-tier tool authorization; Web UI + CLI + macOS menu-bar app. Upstream stdio+HTTP; downstream streamable HTTP. Limitation: with small tool sets the proxy's own menu outweighs the savings (documented breakeven point).

### 6.3 1mcp-app/agent — progressive discovery for agent loops

529★, TypeScript, Apache-2.0, active. `1mcp serve` aggregates servers: static servers at startup + **template servers materialized per client/session context**; presets + filters; cross-server instruction aggregation; optional lazy loading for a stable tool surface and smaller initial schemas. CLI mode walks instructions→inspect→run for progressive discovery (context-friendly); npm global install with a resident serve process; a stdio proxy compatibility mode; telemetry on by default (disablable). Limitation: three access paths (CLI/proxy/direct) make for a概念-heavy ramp.

### 6.4 tbxark/mcp-proxy — minimal, config-is-deployment

742★, Go, MIT, moderately active (2026-09-15). One JSON config declares all upstreams (v2 schema); aggregates tools/prompts/resources into one endpoint; per-upstream **toolFilter** (allow/block) and independent authTokens for route-level auth; upstreams of stdio/SSE/streamable-http; exposes SSE (default) or streamable-http; can perform **interactive OAuth on behalf of downstream and hold/refresh tokens** (e.g. Notion); Docker image bundles npx/uvx. Limitation: fully static — restart to reconfigure, no management surface.

### 6.5 sitbon/magg — the LLM-governed meta-MCP server

143★, Python, **AGPL-3.0** (watch commercial use). Management actions exposed as MCP tools for the model itself: `magg_add/remove/enable/disable` mutate the server set at runtime; aggregated tools carry configurable prefix namespaces; **kits** bundle servers into groups loadable/unloadable together; smart configure uses MCP sampling to generate config from a URL; config.json persisted with hot reload; stdio/HTTP/hybrid modes + a ProxyMCP built-in self-proxy for clients without dynamic tool updates; ships mbro CLI. Unique "LLM self-service capability extension" paradigm. Limitations: AGPL contagion; smallest community.

### 6.6 Other lightweight projects

- **mario-andreschak/FLUJO** (673★, TS, MIT, active): local-first MCP client + visual agent builder; re-exposes MCP servers over Streamable HTTP with a Web UI.
- **vtxf/mcp-all-in-one** (70★, TS, stalled 2025-11): multi-server-in-one aggregator, small but inactive.
- **mark3labs/mcphost** (1591★, Go, MIT, **archived 2026-04**): once the most popular local MCP host; do not select for new work.

## 7. Peripheral Ecosystem

| Project | Stars | Lang | License | One-liner |
|---|---|---|---|---|
| maximhq/bifrost | 9377 | Go | Apache-2.0 | LLM gateway doubling as MCP/agent gateway, OpenAI-compatible single endpoint |
| oomol-lab/open-connector | 6185 | TS | custom | 1500+ SaaS auth connectors exposed to agents via SDK/CLI/MCP/HTTP/OpenAPI |
| Klavis-AI/klavis | 5829 | Python | Apache-2.0 | hosted MCP integration platform for reliable tool use at scale (pushes slowing since 2026-06) |
| 53AI/53AIHub | 4335 | Go | custom | AI portal + knowledge base managing enterprise agents/prompts/MCP tools |
| decocms/studio | 415 | TS | MIT | MCP control plane: connect tools, track tokens/cost (MCP Mesh) |
| Nexus-Router/nexus | 438 | Rust | MPL-2.0 | "plug in all your MCP servers and LLMs" router (stalled 2026-03) |
| e2b-dev/awesome-mcp-gateways | — | — | — | the fullest curated list (bar: 200★ + 2 contributors) |

## 8. Comparison Matrix

| Project | Aggregation model | Management surface | Protocol conversion | Tenancy/auth | Deploy weight | Maintenance |
|---|---|---|---|---|---|---|
| MCPHub | path routing + $smart semantic routing | ★★★★ (dashboard/users/per-user creds) | stdio→HTTP/SSE | users + OAuth/Bearer | light (one container) | very active |
| MetaMCP | Namespace→Endpoint + overrides + middleware | ★★★ (Web UI/SSO/rate limits) | MCP→SSE/HTTP/**OpenAPI** | API key/OIDC/multi-tenant | medium (Compose+PG) | **stagnation risk** |
| ToolHive | Virtual MCP (workflow) + filtering | ★★★★★ (registry/signing/audit/OTel) | stdio→streamable-http | OIDC/per-request policy | heavy (Operator/desktop/multi-repo) | very active (company) |
| ContextForge | Virtual Server + all-protocol federation | ★★★★ (Admin UI/RBAC/OTel) | MCP↔REST↔gRPC↔A2A | JWT/RBAC | heavy (PG+Redis+Nginx) | active |
| Unla | YAML reverse proxy + API→MCP | ★★★ (Web UI/config versioning) | REST→MCP | multi-tenant | light | active |
| obot | vMCP + Git catalog pin/upgrade | ★★★★★ (SCIM/filters/audit) | OpenAPI→MCP + LLM gateway | full IdP+RBAC | heavy | active |
| agentgateway | tool federation + virtual MCP | ★★★ (CEL policies/UI/playground) | MCP/A2A/LLM in one | JWT/OAuth/CEL | medium (binary or k8s) | very active (LF) |
| ms/mcp-gateway | adapter routing + tool router | ★★★ (REST API/portal) | none (Streamable HTTP only) | Entra ID RBAC | heavy (Azure/k8s) | active |
| official registry | pure metadata catalog | ★ (no UI/RBAC) | n/a | namespace ownership proof | light | very active |
| agentic-community | Virtual MCP + registry federation | ★★★★★ (scanning/egress/audit) | MCP/A2A/Skills/REST | full OIDC suite | heavy (Keycloak/Mongo) | very active |
| docker/mcp-gateway | profiles + OCI catalogs | ★★ (CLI/Desktop UI) | stdio/SSE/streaming | built-in OAuth | light (needs Docker) | active |
| mcpproxy-go | BM25 retrieve/direct/sandbox | ★★★★ (quarantine/approval/scan/audit) | stdio→streamable HTTP | 3-tier tool auth | light | active |
| 1mcp | static + template materialization | ★★ (CLI) | streamable HTTP + stdio proxy | — | light | active |
| mcpm.sh | profile grouping → merged endpoint | ★★ (CLI/registry) | stdio→HTTP weak | — | light | active |
| tbxark/mcp-proxy | single-config aggregation | ★ (config only) | stdio/SSE/HTTP + OAuth holding | per-upstream tokens | minimal | moderate |
| magg | LLM-governed dynamic add/remove | ★ (tools-as-management) | stdio/HTTP/hybrid | optional JWT | light | fair |

## 9. Selection Guide

- **Personal machine, unify multi-client configs** → mcpm.sh (broadest config distribution) / docker mcp (if you live in Docker Desktop)
- **Personal machine, fighting tool bloat & malicious servers** → mcpproxy-go (BM25 retrieval + quarantine/approval)
- **Small team self-hosting, turnkey console** → **MCPHub** (most active, least friction) or Unla (if you need API→MCP conversion)
- **Complex tool orchestration, middleware, heterogeneous clients (incl. OpenAPI exposure)** → MetaMCP (accept the maintenance risk) or ToolHive Virtual MCP
- **Enterprise K8s + security/compliance (audit/signing/SSO)** → **ToolHive** (Operator + audit) or agentgateway (traffic-layer governance)
- **End-to-end enterprise governance (MCP + models + devices + audit)** → obot (accept the commercial license boundary)
- **Self-built private registry + gateway, AWS ecosystem** → agentic-community/mcp-gateway-registry
- **All-protocol federation (REST/gRPC/A2A → MCP)** → IBM ContextForge
- **Metadata-standard alignment (external interface)** → adopt the official registry's server.json schema + v0 API
- **Exploring agent-self-governance paradigms** → magg (mind AGPL) / 1mcp
- **Azure-bound, latest-MCP-protocol-only** → microsoft/mcp-gateway

## 10. Takeaways for This Workspace (DSH ecosystem)

1. **server.json is the standard worth aligning to**: DSH already has a market (registry index.json + plugin package distribution); the official registry's server.json schema plus namespace ownership verification (GitHub OAuth / DNS challenge) is a ready-made design for the missing "publisher ownership" layer in DSH market publishing.
2. **Aggregation's value keeps being re-proven**: full tool exposure → on-demand retrieval (MCPHub $smart / mcpproxy BM25 / ToolHive Optimizer's claimed 85% token savings) is the shared evolutionary direction; DSH sessions already mount tools per page scope (task-workbench list/detail mutual exclusion) — same idea.
3. **Per-user credentials are a hard requirement for shared servers**: MCPHub's personal-key binding + stdio runtime isolation, and agentic-community's egress auth (gateway-held third-party SaaS tokens), are direct references for multi-session shared plugin credentials in DSH.
4. **Pin/upgrade catalog snapshots**: obot's vMCP pins components to catalog snapshots and requires an explicit upgrade — more controllable than "installed means auto-updated"; relevant to DSH bundle version strategy.
5. **A tool-override layer**: MetaMCP's Tool Overrides (rewriting descriptions, injecting readOnlyHint annotations) show tool metadata is governable data; DSH's tool-description gate fixes already do similar work — the mechanism could be made explicit.
6. **Risk checklist**: MetaMCP's stall proves single-maintainer risk is real — when importing external MCP components, prefer company/foundation-backed projects (ToolHive/agentgateway/obot).

## 11. Sources

- Each repository's README (GitHub API raw, fetched 2026-11-05) and repo metadata API
- [e2b-dev/awesome-mcp-gateways](https://github.com/e2b-dev/awesome-mcp-gateways)
- [agentgateway.dev docs](https://agentgateway.dev/docs/standalone/latest/documentation/mcp/about.md)
- [ToolHive CLI reference](https://docs.stacklok.com/toolhive/reference/cli/thv_run)
- [Scalekit: Best Open Source MCP Gateways in 2026](https://www.scalekit.com/blog/best-open-source-mcp-gateways)
- [Composio: 10 Best MCP Gateways for Developers](https://composio.dev/content/best-mcp-gateway-for-developers)
- [Lunar.dev: Best Open Source MCP Gateways](https://www.lunar.dev/post/the-best-open-source-mcp-gateways-in-2026)
- [Manveer's Substack: Best MCP Gateways Hands-On Comparison](https://manveerc.substack.com/p/best-mcp-gateways)
