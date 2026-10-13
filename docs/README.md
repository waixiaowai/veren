# docs — Manuals and tutorials for readers

[中文文档](./README.cn.md)

This directory holds **outward-facing** documentation: manuals, tutorials and guides for
specific audiences. Unlike the per-package `README.md` / `README.cn.md` pairs (how to use
each package, per the `AGENTS.md` conventions), documents here are organized by audience
and cover cross-package topics.

## Audiences and what belongs here

| Audience | Content | Suggested naming |
| --- | --- | --- |
| Users | installation, getting started, FAQ | `user-*.md` |
| App developers | tutorials for using veren packages in products | `guide-*.md` |
| Package developers | architecture, pipeline design, extension points | `design-*.md` |
| AI agents | structured, machine-consumable project briefs | `agent-*.md` |

## Writing conventions

- Use the language and vocabulary of the target audience; keep implementation details out
  of user-facing documents.
- State the target audience and required background at the top of every document.
- Link to the package's README pair (`README.md` / `README.cn.md`) instead of duplicating
  its content.

## Current documents

Empty — contributions are welcome following the table above.
