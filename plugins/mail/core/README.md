# @veren/mail

The notification domain as a DSH plugin: turn a business event into messages
that really reach people, and keep an auditable trail of what every trigger
did.

Part of the `@veren/mail-bundle` stack. Read the [bundle README](../bundle/README.md)
first for the one-row install; this document is the core's own contract.

## What it owns

- **The durable domain** — workflows, recipients, groups, preference layers,
  channel integrations, execution chains, step instances, delivered messages,
  and conversations, all in the host storage domain (`mail`, `per-record`
  layout) under `$DSH_HOME/storages`.
- **The delivery chain** — trigger → dispatch → deliver. A trigger is
  validated and accepted synchronously; its steps advance through an internal
  queue with atomic claiming (a compare-and-set on `queued → running`), a
  30-second lease, and at most three attempts per step with exponential
  backoff.
- **Two channel providers** — the station inbox (`in_app`, always on, no
  external call) and SMTP (`email`, enabled by config). The message record is
  written before the provider is called, and the provider's receipt is always
  written back.
- **The `mail` Remote namespace** — what the web panel reads.

## Deliberate boundaries

- An accepted trigger is not a delivered message: the acceptance status and
  the chain's facts are different facts, and the tools keep them apart.
- A skipped step is a decision, not a failure: each skip names the judgment
  that stopped it (`step_condition`, `preference`, `missing_email`,
  `missing_phone`, `missing_push_token`, `missing_webhook_url`).
- Preferences merge through five fixed layers — workflow, operator,
  recipient-global, recipient-workflow, subscription — and a read-only layer
  truncates the merge instead of being ignored.
- Every failure carries a stable `MAIL_*` code with its retryability built in.
- Service: `mailService` (inject `MailServiceToken`). Gateway: `mailGateway`
  on the `mail` namespace.

## Install

Install `@veren/mail-bundle`; it composes this core, the tools, and the panel
in the right order. To compose by hand, insert a loader row:

```yaml
- insert:
    - id: mail
      name: '@veren/mail'
      config:
        enabled: true
        # smtp:                      # optional; opens the email channel
        #   host: smtp.example.com
        #   port: 587
        #   secure: false
        #   from: no-reply@example.com
```

## Config

| Field | Meaning |
| --- | --- |
| `enabled` | mount gate; `false` registers nothing |
| `smtp` | optional mail server (host, port, secure, from, user, password); absent keeps the station inbox as the only channel |

## Development

```bash
pnpm --dir plugins/mail/core typecheck   # tsc over src and tests
pnpm --dir plugins/mail/core test        # vitest, in-memory store, no host
pnpm --dir plugins/mail/core build       # tsc -> dist/
```
