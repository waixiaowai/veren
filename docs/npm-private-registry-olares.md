# npm Private Registry on Olares (Verdaccio)

> Audience: team members who publish or install `@veren/*` (and other private-scope) npm packages.
> 读者对象：需要发布或安装 `@veren/*`（及其他私有 scope）npm 包的团队成员。中文版见 [README.cn.md](./npm-private-registry-olares.cn.md)。

## The registry / 仓库信息

| Item / 项目 | Value / 值 |
|---|---|
| Software | Verdaccio 7.0.2 (standard open-source npm registry) |
| URL (external) | `https://830a2922.comilogic.olares.cn` |
| Web UI | same URL — browse packages, log in |
| Runtime | Olares app `verdaccio` (chart 0.1.5, namespace `verdaccio-comilogic`) |
| Accounts | seeded by the admin (self-registration is closed) |
| Admin | `admin` — password delivered once out-of-band, store it in a password manager |

## Install / 拉包（匿名，无需账号）

`@veren/*` is readable anonymously — same posture as the existing `npm.veren.top`.

**The one gotcha that will bite you:** the `--registry` CLI flag does **NOT** override the
scope routing already written in any `.npmrc` (project or user level). This machine maps
`@veren` to `npm.veren.top`, so an install silently goes to the wrong registry. Always use a
directory-local `.npmrc`:

```ini
# <your-project>/.npmrc  (or a temp dir for one-off tests)
registry=https://830a2922.comilogic.olares.cn/
@veren:registry=https://830a2922.comilogic.olares.cn/
```

Two subtleties about where npm actually finds that file:

- npm picks the nearest `.npmrc` **walking up from the cwd to the closest `package.json` /
  `node_modules`** — an `.npmrc` in a subdirectory below a package root is silently ignored.
- Cheap proof you got it right: `npm config list` annotates every losing key with
  `; overridden by project`. If you don't see that annotation, the routing never happened.

One more silent-failure door, Windows + Git Bash specifically: `NPM_CONFIG_USERCONFIG` must be
a **Windows-native path** (`cygpath -w /tmp/...npmrc`); a literal POSIX `/tmp/...` value does
not resolve, npm silently falls back to the user-level config — and you land exactly on the
wrong-registry failure this section warns about.

Then:

```bash
npm install @veren/imagegen        # resolves from the Olares registry
npm view @veren/imagegen versions  # anonymous metadata read works
```

Any other package (not `@veren/*`) is fetched through the uplink cache from
`registry.npmmirror.com` on first request, then served from the local cache.

## Publish / 发包（需账号）

Publishing requires a token. Get an account from the registry admin (self-registration is
disabled), then:

```bash
# Write a publish-only .npmrc (never commit it; keep it out of the repo)
mkdir -p ~/.config/npm-olares
cat > ~/.config/npm-olares/registry.npmrc <<EOF
registry=https://830a2922.comilogic.olares.cn/
@veren:registry=https://830a2922.comilogic.olares.cn/
//830a2922.comilogic.olares.cn/:_authToken=<YOUR_TOKEN>
EOF

# Publish exactly the way market/release.mjs does — a temp userconfig, nothing global
NPM_CONFIG_USERCONFIG=~/.config/npm-olares/registry.npmrc npm publish
```

To obtain `<YOUR_TOKEN>` yourself (needs your account's password):

```bash
curl -u <user>:<password> -X PUT -H 'Content-Type: application/json' \
  -d '{"name":"<user>","password":"<password>"}' \
  https://830a2922.comilogic.olares.cn/-/user/org.couchdb.user:<user>
# → JSON body contains "token": "..."
```

Rules:

- **Same version can never be re-published** (registry immutability — matches the repo's
  versioning rules: bump first, then publish).
- `--access public` is accepted but not required (unlike npmjs.com, Verdaccio publishes scoped
  packages with default access).
- Cleanup: `npm unpublish <pkg>@<ver> --force` — npm refuses to delete a package's **last
  version** without `--force`, and smoke-test packages are usually single-version. Note
  unpublishing the last version of a name blocks re-publishing that name for 24h (npm client
  policy). Third routing trap: `npm unpublish` ignores scope keys from a `userconfig` — run it
  from a directory whose own `.npmrc` carries the two registry lines, or it silently targets
  registry.npmjs.org (404).

## Admin operations / 管理操作

All via `olares-cli` (v1.12.7+). Find the pod first:

```bash
olares-cli cluster pod list -n verdaccio-comilogic -o json
```

**Create a user** (self-registration is closed by `max_users: -1`):

```bash
# Generate a password + an htpasswd-compatible hash locally, then append via exec
PASS=<random-password>
HASH=$(openssl passwd -apr1 "$PASS")
olares-cli cluster pod exec verdaccio-comilogic/<pod> -c verdaccio -- \
  sh -c "echo '<user>:$HASH' >> /verdaccio/storage/htpasswd"
```

The `htpasswd` file lives on the app's persistent volume (`appData`), so users survive pod
restarts and app upgrades (verified: login still 201 after workload restart and two chart
upgrades).

**Delete a published version:** `npm unpublish --registry <URL> <pkg>@<ver>` with a token, or
`curl -X PUT .../-/user/...` for auth and the DELETE endpoint for the tarball.

## Policy / 策略一览

| Package pattern | access (read) | publish | uplink proxy |
|---|---|---|---|
| `@veren/*` | anonymous | authenticated | **none** (local-only — blocks dependency-confusion) |
| `@*/*`, `**` | anonymous | authenticated | `registry.npmmirror.com` (cache-only) |

Other settings: request body limit 100mb, version immutability on, `X-Forwarded-For` trusted
from the cluster pod CIDR, self-registration closed.

## Relation to npm.veren.top / 与 npm.veren.top 的关系

`npm.veren.top` (also Verdaccio) keeps serving the existing `@veren/*` line, the market and
the three DSH environments — nothing moved. This Olares registry is a **parallel** registry.
Migrating the `@veren/*` line over is a separate decision (registry immutability means
consumers switch by rewriting scope config; versions already published stay on the old host).

## Known limitation / 已知限制

- **In-cluster consumers cannot reach this registry yet.** Cross-namespace traffic between
  per-user apps is blocked by the platform (probes from `gitearunner` to this app time out at
  TCP, and the only lane that pod has is the giteaclone service). Options for the future:
  convert the chart to a shared app (`options.shared: true`, platform-granted mesh +
  NetworkPolicy lanes; requires reinstall into a `-shared` namespace) — undecided.
- The pod is pinned to node `olares-worker` (same lane as the CI runner; cross-node paths were
  the ones that misbehaved). Data is on JuiceFS (`appData`), so the pin is restart-safe.
- Image pinned by exact tag `7.0.2` (Verdaccio never retags published version tags); digest
  pinning deferred — Docker Hub / daocloud manifest endpoints are unreachable from this network.

## Chart source / chart 源

The chart source is recoverable from the instance:

```bash
olares-cli market download verdaccio   # fetches the stored .tgz
```

Decision record for every chart choice: `NOTES.md` inside the chart (chart dir was
`.tmp-registry-chart/verdaccio/` in the cursour workspace when authored).
