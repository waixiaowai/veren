---
description: 让大管家（person-agent）接管这件事：判断、并行派活、汇报结果。
argument-hint: "[要办的事]"
skills: dispatch
---

用 Agent 工具以 `subagent_type: person-agent` 派出一个大管家子代理，把下面这件事完整交给它（它在自己的会话里判断与派活，你只需转交与等待结果）：

$ARGUMENTS

派出时把用户的原话与必要的上下文（工作区、相关文件路径）一并在派单里给足；结果回来后，用平实的中文向用户转述结论与下一步。
