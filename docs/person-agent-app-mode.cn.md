# Person Agent 的应用模式（app-only）

> 面向开发者。本文记录 Person Agent 从「preset 组合栈」迁到「纯应用栈」的最终形态、迁移理由与边界。

## 最终形态

```text
@veren/person-agent-bundle          # profile 层：patch 只插 person-agent-app 一行
├─ @veren/app-host-bundle           # 应用框架（依赖带入，自行插框架行）
└─ @veren/person-agent-app          # 应用：桥梁人设 + 2 页 + 页面级工具/技能
   ├─ @veren/person-agent-tool-session     # 纯 builders（session_* 七件套 + 结算看守）
   └─ @veren/person-agent-tool-workspace   # 纯 builders（workspace_* 三件套）
```

- **没有预设行**。`person-agent-preset`、`person-agent-dynamic-context`、`person-agent-reanchor` 三个包已删除。
- **没有全局注册的工具**。`person_agent__*` 十个工具（九个无状态 + `session_dispatch`）只存在于 `/apps/person-agent/*` 页面会话的 agent 作用域；普通会话看不到，skill 目录里也没有 `renhua`。
- **人设与硬规则的落点**：
  - 桥梁人格 → `APP_DEFINITION.instructions`，经 PAGE 块的「应用说明：」行进入每个页面会话；
  - 带数字的「停手派活」硬规则（连续 3 步以上只分析且没派活 → 停手）→ 概览页的页面说明末尾。
- **`session_dispatch` 的结算看守随页面视图创建/销毁**：页面组件在 `ctx.page.effect` 里 `createSettlementWatch` 并注册同名的动态工具定义，effect 清理即结清全部看守——废弃的页面会话不会留下悬空的回报。

## 页面与工具

| 页面 | 正文 | 页面工具（全部 agent scope） | skill |
|---|---|---|---|
| `/apps/person-agent/overview`（entry） | 应用目录 + Workspace List + Agent Preset List + Model Catalog + 待办任务 | `workspace_session_list`、`session_create/rename/dispatch/archive/unarchive/pin/unpin`、`workspace_create/rename` | renhua |
| `/apps/person-agent/workspaces` | 工作区行 | `workspace_session_list`、`session_create`、`workspace_create/rename` | renhua |

工具两张脸：无状态九件走 `meta.tools` 静态声明（暂存预挂即终态）；`session_dispatch` 是唯一的动态脸（`ctx.page.tool`），因为它携带页面自己的看守。目录（市场/权限/发现）列全十个工具，构建器与页面挂载的是同一份 `ToolDefinition`。

## 页面级 skills（本轮新增的框架面）

`ComponentPageMeta.skills` / `PageDefinition.skills` 声明页面级运行时技能；page-registry 收集后与工具同一端口挂载（`PageSessionPort.mountTools(sessionId, tools, skills?)`），app-host 在 `mountOnAgent` 里用 `agent.ctx.skills.register` 注册进会话 agent 作用域，注销器与工具同一组逆序清理。`renhua` 是第一个使用者。

## 应用级 instructions（本轮新增的框架面）

`componentPageBlock` 现在渲染 `应用说明：<app.definition.instructions>`，排在 `说明：<page.instructions>` 之前——先读「这个应用是谁」，再读「这一页怎么用」。

## 迁移与兼容

- **旧 preset 会话**：preset 行删除后无法恢复（`agent-preset/not-found`）。这是接受的 0.x 破坏性变更；旧包不再发布迁移通道。
- **双轨兼容**：没有。退役即删除，`dsh-skill-filesystem` 的 preset 子行、dynamic-context 的工作记忆、reanchor 的定期提醒全部随 preset 栈一起退役。工作记忆的替代物是概览页正文的三块名单（挂载时读一次 + PAGE-PATCH）。

## 相关文档

- 设计纪实：`docs/prompt-page-render-design.md` / `.cn.md`
- preset 时代的场景设计（落点已更新到页面）：`docs/scene-preset-design.md` / `.cn.md`
