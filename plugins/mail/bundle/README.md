# @veren/mail-bundle

The notification stack as one installable profile layer: three `@veren`
plugins composed in dependency order by one configuration-only bundle.

## What mounts

| Row | Package | What it brings |
| --- | --- | --- |
| `mail` | @veren/mail | the notification domain: durable workflows, recipients, groups, preferences, execution chains in the host storage domain; the trigger → dispatch → deliver chain; the station inbox (`in_app`, always on); the optional SMTP email channel; the `mail` Remote namespace |
| `mail-tool` | @veren/mail-tool | the twelve `mail_*` model-facing tools and the bundled `mail-notifications` skill |
| `mail-ui` | @veren/mail-ui | the web panel: the station inbox with its visible-state actions, and the per-step activity view |

Row order matters and is pinned by the bundle's own specs: the core first (it
provides the service), then the tools (they read it), then the panel (it
injects the mounted namespace). A row whose inject cannot resolve stays
pending — loudly visible in the plugin page and boot logs, never a silent
half-activation.

## Install

From the market, or for a local profile:

```bash
pnpm --dir deepseek/deepseek-harness dsh plugin --profile web add plugins/mail/bundle
```

Then enable it in the profile's plugin page, and restart the host.

### Opening the email channel

The station inbox works with no configuration. To also send real email, give
the `mail` row an `smtp` block (host, port, secure, from, and optionally
user/password) — see the patch in `cordis.patch.yml`. Keep the password in the
profile config only if you accept plaintext on disk; otherwise omit the SMTP
block entirely.

## Verify

- Services: the `mail` row shows enabled with no pending injects; boot logs
  carry no `waiting for inject` line for it.
- Tools: ask an agent for its tools — the `mail_*` family appears.
- Skill: the `mail-notifications` skill is listed in the session's skill
  catalog.
- Panel: the sidebar shows the notification entry; the inbox opens (empty
  until something is sent).
- End to end: create a subscriber and a one-step workflow (a small
  `workflowId: wf-1` row is not seeded — write them through `mail_set_subscriber`
  and a workflow insert, or ask the agent), then trigger and watch the inbox
  and the activity tab.

## Development

```bash
pnpm --dir plugins/mail/bundle test    # manifest + patch shape specs
```
