# @veren/im

Provider-neutral IM contract, registry, storage, and active-binding router for
the DeepSeek Harness.

## When to use it

Use this package when a DSH host must expose one IM abstraction to multiple
channels: accounts, conversations, bindings, inbound routing, and explicit
outbound targets. It is the core package, not a channel implementation and not
the tool surface.

Do not use it as a place to add channel-specific branches. A channel belongs in
its own provider package (`@veren/im-wechat` in this repository), registered as
one `ImProvider`.

## Package set

| Package | Role |
|---|---|
| `@veren/im` | Contract, `ImRegistry`, `ImError`, storage, router, DSH Session bridge |
| `@veren/im-tool` | Model-facing `im_*` tools |
| `@veren/im-wechat` | WeChat iLink provider |
| `@veren/im-testkit` | Fake provider and reusable conformance suite |

## Contract

The contract is the source of truth:

- `ImAccount`: `id`, `displayName`, `ownerId?`, `status`
- `ImConversation`: `id`, `kind` (`direct` / `group` / `thread`), `title?`
- `ImMessage`: `id`, `accountId`, `conversationId`, `sender`, `sentAt`,
  `content`, `replyTo?`, `threadId?`
- `ImMessageContent`: `text`, `markdown`, `image`, `file`
- `ImFeatures`: direct/group/threads/markdown/media/typing/auth/limits
- `ImBindRequest`: a union discriminated by `method`; no generic options pocket
- `ImBindAttempt`: `bindId`, `status`, `challenge`, `submitCode`, `wait`,
  `cancel`
- `ImSendRequest`: explicit `target`, `content`, optional `replyToMessageId`
- `ImSendResult`: `id`, `sentAt`, `uncertain?`
- `ImBinding`: `id`, `accountId`, `conversationId`, `sessionId`, `active`,
  `settings`
- `ImBindingSettings`: `presetId`, `provider`, `model`, `reasoning`
- `ImPersonContact`: `kind` (`wechat` / `email` / `phone` / `other`), `value`, `label?`
- `ImPersonView`: `id`, `displayName`, `realName?`, `aliases`, `contacts`, `bio?`,
  `notes?`, `addresses`, `updatedAt`
- `ImPersonMatch`: the person plus the evidence (`matchedBy`, `matchedValue`)
- `ImPersonResolution`: `matched` / `ambiguous` / `not-found`
- `ImError`: `code`, optional `providerCode`, optional JSON-safe `details`

`ImService` has exactly `start`, `stop`, `accounts`, `listen`, `bind`, and
`send`. Provider identity and capabilities live on the `ImProvider` descriptor
(`id`, `displayName`, `features`, `service`).

`ImRegistry` has exactly `register`, `get`, and `list`; `get` throws
`IM_NOT_FOUND`. Every registration is disposed through the registering fiber.

## Routing rules

1. An inbound message resolves the active binding for its
   `(accountId, conversationId)`.
2. With no active binding, `autoCreateSession` decides between creating a
   Session plus an active binding, or logging and ignoring the message.
3. Source metadata and message body are rendered as two separate sections; the
   body is untrusted input.
4. Messages from one conversation are serialized.
5. The answer returns to the exact conversation that produced the turn, never to
   "the current active binding".
6. Activating a binding turns every other active binding for that conversation
   off in the same serialized write.

## People and name resolution

An account is what this host authorized; a person is a human. `ImAccount` has
no identity data beyond its live display name, so sending by name needs this
separate layer:

- `im_people` stores one profile per human: `display_name`, optional
  `real_name`, `aliases` (remarks or other names), `contacts`, `bio`, `notes`,
  and `updated_at`.
- `im_person_addresses` stores provider-scoped destinations. `external_id` is
  the provider's own user id; `conversation_id` is what a send ultimately
  targets. One person may have several addresses (for example two WeChat
  accounts).

Resolution rules are deliberately strict:

1. One exact match sends. Exact means normalized equality (NFKC, trim, collapse
   spaces, case-fold) against the person id, real name, display name, an alias,
   a contact (phone numbers ignore separators and a country prefix), or an
   address.
2. Two or more people matching exactly is `IM_AMBIGUOUS`; nothing is sent and
   the candidates are returned (at most 20).
3. Zero exact matches is `IM_NOT_FOUND` with up to five close-name suggestions;
   a partial match is never promoted to a send.
4. One person with several names is one match: aliases are additional keys onto
   the same person, not additional people.
5. One person with several reachable addresses is `IM_AMBIGUOUS` too; the
   caller must narrow with `provider` or `accountId`.
6. A person with a profile but no address is `IM_NO_ADDRESS`; a profile alone
   cannot receive a message.

The router records every inbound sender into the directory before routing, and
seeds direct conversations already in storage at activation. A provider that can
enumerate its own contacts may contribute addresses through the `imPeople`
service (`ctx.imPeople.observeConversation` / `.save`) without changing
`ImService`. WeChat V1 cannot enumerate contacts; see `@veren/im-wechat`.

## Storage

The storage domain is `im`, version 1:

```text
im_accounts(id, provider, token_ref, owner_id)
im_conversations(account_id, conversation_id, kind, title)
im_bindings(id, account_id, conversation_id, session_id, active, settings_json)
im_people(id, display_name, real_name, aliases, contacts, bio, notes, updated_at)
im_person_addresses(person_id, provider, account_id, conversation_id, external_id, display_name, updated_at)
```

No online status and no creation time are persisted. `token_ref` is only a
credential reference; secrets live in `ctx.credentials`.

## Plugin

- name: `im`
- injects: `storageDomain`, `credentials`, `agents`
- provides: `im` (`ImRegistry`), `imRouter` (`ImRouter`), and `imPeople`
  (`ImPeople`)
- config: `autoCreateSession` (default `false`), `replyTimeoutMs` (default
  `120000`)

The DSH session bridge delivers one `createUserMessage` with source kind
`im-message`, captures that turn's `assistant/message` text, and settles at
`turn/end`.

## Limitations

- No message history, archive, or full-text search.
- No binding-management UI; the data model already allows many bindings per
  conversation and many bindings per Session.
- Model settings (`provider` / `model` / `reasoning`) apply when a Session is
  created; changing them on an existing Session is not implemented.
- Reply capture assumes one routed turn per Session at a time; the router
  serializes prompts per Session, but a human using the same Session in the GUI
  at the same moment is outside V1.
- The directory only knows what a provider exposes or a human records. It is not
  a global address book, and it does not merge identities across channels
  automatically: one human with two providers is two addresses on one person
  only after `im_person_save` links them.

## Commands

```bash
pnpm --filter @veren/im typecheck
pnpm --filter @veren/im test
pnpm --filter @veren/im build
```
