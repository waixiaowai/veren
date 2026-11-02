# @veren/zhihu-ops

Operations analysis for your own Zhihu account, as a Veren application.

It pulls your account and content statistics from the **official Zhihu open
platform** on a daily schedule, keeps the daily snapshots in a durable storage
domain, derives follower growth and content performance from them, writes an
LLM-written report, and delivers that report to your inbox through the task
center.

Everything it does against Zhihu is a **read**. It never publishes, comments,
or follows on your behalf.

## When to use

Use it when you run a Zhihu account and want the numbers collected and turned
into analysis on a schedule, without a spreadsheet ritual.

Skip it when you do not use Zhihu, or when you want an agent to publish on
Zhihu — that is a different (and riskier) product.

## The pipeline

```
daily schedule → pull (read-only) → durable snapshots → derived metrics
                                                      ↓
                                        LLM-written report → task center inbox
```

- **Pull.** Once a day, at the configured local time. It reads the account
  stats, your content list, the per-content funnel stats (exposure UV, reads,
  upvotes, likes, comments, collects, read-finished rate, follower gain), the
  comments on your own works, the hot list, and the answerable questions.
- **Idempotency.** A pull is keyed by the local calendar day: re-collecting the
  same day **overwrites** rather than accumulates, and a restart never re-pulls.
  A failed day is recorded honestly as `failed` or `partial` in the pull ledger.
- **Derivation.** Follower growth, per-content movers, and reply candidates are
  pure functions over the stored snapshots, so the pages and the report read one
  single definition.
- **Report.** One LLM call writes the report from the fact block. It runs
  outside any session, so it never wakes an agent or enters a conversation log.
- **Delivery.** The report goes to the task center, so it lands in your own
  inbox with the host's own notification and completion tracking.

## Setup

1. Register at [developer.zhihu.com](https://developer.zhihu.com) and create an
   **Access Secret**.
2. Install the bundle:
   ```bash
   dsh plugin --profile web add @veren/zhihu-ops-bundle
   ```
3. Open the Zhihu operations application and call `setup_credentials` with the
   Access Secret. It lands in the credential store — never in configuration and
   never in a log.

## Pages

| Page | URL | What it is for |
|---|---|---|
| overview | `/apps/zhihu-ops/overview` | Follower trend, the pull ledger, credential state |
| contents | `/apps/zhihu-ops/contents` | Every piece with its latest metrics and the window's growth |
| content | `/apps/zhihu-ops/content/:contentId` | One piece's day-by-day curve and its comments |
| reports | `/apps/zhihu-ops/reports` | The report list and the newest report in full |

## Tools

- tool: `refresh_now` — pull the data right now
- tool: `setup_credentials` — store the Access Secret
- tool: `generate_report` — write a report and deliver it to the inbox
- tool: `list_contents` — the contents with their metrics, ordered by growth
- tool: `content_trend` — one content's day-by-day trend
- tool: `suggest_topics` — the answerable questions and the hot list

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `pullLocalTime` | `08:00` | The daily pull time, local `HH:mm` |
| `dailyCallLimit` | `60` | The local daily call cap (0 = unlimited) |
| `requestIntervalMs` | `3000` | The minimum gap between two pull requests |
| `reportCadence` | `weekly` | `daily` or `weekly` |
| `reportWindowDays` | `7` | How many days one report covers |
| `contentLimit` | `20` | How many contents one pull reads |
| `autoPull` | `true` | Whether the scheduled pull runs |

## Notes on the measures

- The official contract distinguishes **upvote** (`UpvoteCount`) from **like**
  (`LikeCount`). The plugin keeps them apart; they are not merged into one
  "likes" number.
- The engagement rate the pages show is a **proxy**: (likes + comments +
  collects) over views. The official read-finished rate is reported separately
  and is left absent when the platform did not return it.
- Numbers the platform did not return stay absent. The plugin never zero-fills
  a missing metric, because a zero would read as "this piece got no views".
