# @veren/mail-tool

The model-facing surface of the notification stack: the `mail_*` tools plus
the bundled `mail-notifications` skill.

Mounts over `@veren/mail` and owns no domain logic — every tool is a thin
projection of one service call.

## The tools

- tool: `mail_send` — fire a workflow by trigger identifier; the answer says whether the trigger was accepted, not delivered
- tool: `mail_workflows` — list what can be sent, with each workflow's status and steps
- tool: `mail_activity` — read the execution chains, with each step's state and skip reason
- tool: `mail_subscribers` — list the recipients and where they are reachable
- tool: `mail_set_subscriber` — create or update one recipient; only named fields are written
- tool: `mail_groups` — list the groups and their members
- tool: `mail_set_group` — create or rename a group by its immutable key
- tool: `mail_subscribe` — add or remove one group member
- tool: `mail_inbox` — read the station inbox, newest first
- tool: `mail_mark_message` — mark one inbox message read / unread / archived
- tool: `mail_conversations` — list the notification conversations
- tool: `mail_conversation_messages` — read one conversation in order

## The skill

- skill: `mail-notifications` — when a notification is the right instrument, one workflow per kind of notice, the accepted-vs-delivered distinction, the skip reasons, and the idempotency rule

## Install

Mounts as part of `@veren/mail-bundle`. Config:

| Field | Meaning |
| --- | --- |
| `enabled` | register the `mail_*` tools (default `true`) |
| `skill` | register the bundled skill (default `true`) |

## Development

```bash
pnpm --dir plugins/mail/tool typecheck
pnpm --dir plugins/mail/tool test
pnpm --dir plugins/mail/tool build
```
