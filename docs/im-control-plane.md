# IM control plane on the cloud: data-home boundary (2.3.0)

Status: adopted (2026-10-27) · Supersedes: none · Depends on: [im-multi-device-hub.md](./im-multi-device-hub.md) (the 2.2.0 cloud-hub ADR)

## Decision

After the WeChat channel moved to the CMS cloud (2.2.0), the control-plane facts of IM live on the cloud, and local plugins are demoted to device-plane adapters. The home-ruling principle:

> **Any fact that must survive a device change lives on CMS; state that only serves this device's agent lives on the device.**

### Data-home table

| # | Fact | Home | Primary reader | Primary writer |
|---|------|------|----------------|----------------|
| 1 | Authorization session (bot token / QR flow / -14 liveness) | **CMS** (ruled in 2.2.0) | device plane (indirect), user plane | CMS poller |
| 2 | Message log (each inbound text + seq + routing outcome) | **CMS** | user plane, device (long poll) | CMS poller |
| 3 | Conversation map (p2p conversation <-> sender <-> context token) | **CMS** | device (reply addressing) | CMS |
| 4 | People identity (person, display/claimed/note, address binding) | **CMS** (added this train) | device (read cache for prompts), user plane | device upserts + one-time import + user-plane rename |
| 5 | Device registry (device name, cursor) | **CMS** (device column exists since 2.2.0) | CMS, user plane | device long poll |
| 6 | Intake records (stranger-ask issued/expired/answered history) | **device** | this device's intake tab | this device's intake flow |
| 7 | Private sessions (DSH session id map) | **device** | this device's queue | this device's gateway |
| 8 | Queue state machine (queued/consuming/replied/dead + attempts) | **device** | this device's conversations tab (pending column) | this device's queue |
| 9 | Local delivery cache (messages rows) | **device** (demoted: local audit view only) | this device | this device |

### Decision point D1: view host

The IM overview views (accounts/conversations/people/intake tabs) are hosted by the **DSH panel**, fetching from the CMS user plane; the CMS web side gains no IM views (it stays the operations/admin surface). Rationale: users already live in the DSH panel; the CMS web IM face is admin-only (QR authorization / session audit).

### Credential tracks

| Credential | Plane | Carrier |
|------|----|------|
| Device API Key ( with ) | device plane  | DSH plugin config (unchanged) |
| Admin/operator () | admin face + bulk import | CMS session/JWT |
| **User plane (new )** |  | panel login:  exchanges credentials for a Bearer JWT (cross-origin ready, existing T22 facility) |

The three tracks never cross: a device key on the user plane -> denied; a JWT on the device plane -> denied; a user without  -> 403/empty.

## CMS user-plane endpoints (read-first; the write face has exactly two items)

| Endpoint | Guard | Meaning |
|------|------|------|
|  | auth tri-state +  | session state (bot liveness/owner) + message/people counts |
|  | same | message log (newest first, limit) |
|  | same | people directory (with address bindings) |
|  | same | rename display name / note (mirrors the device renamePerson semantics) |
|  | auth tri-state +  | re-authorization trigger (delegates to the manage permission) |

Device-plane additions (guards unchanged, ):

| Endpoint | Meaning |
|------|------|
|  | devices push observed/self-reported identity deltas (idempotent, keyed by address) |
|  | devices pull the directory (read cache for prompt building) |
|  | **admin face** (): one-time bulk import of a local directory |

## Device-side adaptation

-  core gains an optional remote-directory seam : when registered (provided by the hub plugin) people observation goes push + read-cache; when absent behavior stays local-only (the direct-WeChat single-machine shape does not regress).
- The im-ui tabs fetch per the home table: accounts tab reads user-plane session state (the local bind wizard retires — authorization lives on the cloud); conversations tab reads the message log from the cloud + the pending column locally; people tab reads the cloud (rename via the user plane); intake tab stays local.
- The local directory enters the cloud through the import endpoint (, dry-run by default).

## Acceptance (the ADR acceptance section)

1. **Two-device consistency**: a second device signed in to the same CMS user — identical people/conversation views, no second intake for the same sender, send/receive works.
2. **The cloud is the fact source**: kill and restart CMS — the user-plane views rehydrate from the database; meanwhile device messages queue without loss.
3. **Permission probes**: a user without  gets 403; a device key on  is denied; a JWT on  is denied.
4. **Two-sided terminal audit**: every row of  is visible on the user plane AND has a device-side outcome (messages table or queue state).

## Explicitly out of scope (this train)

Cloud-side message execution (agents stay on devices), multi-tenant CMS, content routing, device-management UI, the /device switch command (separate task for the official release).

## Version

The  line moves to **2.3.0** (MINOR: the CMS user plane + the remote-directory seam are new capabilities); the CMS keeps its own version line.
