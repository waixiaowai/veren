# gitea-cli

A minimal, dependency-free command line for a Gitea instance's `/api/v1`, written for [dsh-superagent](../../README.md). It is the `cli` that the Gitea Source and the agent's workers call: the plugin reads notifications, issues, pull requests, comments, and CI statuses through it, and workers push branches and open pull requests with it.

The token lives in a **config file, never an environment variable**: DSH strips credential-shaped variable names (`KEY`, `PASSWORD`, `SECRET`, `TOKEN`) from child process environments, so a file is the only reliable carrier.

## Configuration

`--config <path>`, or `GITEA_CLI_CONFIG`, or `~/.config/gitea-cli/config.json`:

```json
{ "url": "https://gitea.example.com", "token": "<access token>", "login": "agent-account" }
```

`login` is optional; `gitea api user` resolves it. Create the access token in Gitea under Settings → Applications, with at least `repository` read+write scope.

## Commands

- `gitea api <path> [--method GET|POST|PUT|PATCH|DELETE] [-f key=value]... [-H 'Header: value']...` — one authenticated call. The path is instance-relative (`user`) or repository-relative (`repos/owner/name/issues/1`). The response body prints as received. HTTP failures print `gitea: <message> (HTTP <status>)` on stderr and exit 1, which is the shape dsh-superagent's error parser reads.
- `gitea auth status` — prints `{host, login, id}` as JSON.
- `gitea auth git-credential get|store|erase` — a git credential helper; `get` answers `username=`/`password=` from the config file when the requested host matches. `store` and `erase` are no-ops.

## Installation

The script needs Node.js 18+ on `PATH` and its executable bit set. dsh-superagent's worker environment wraps it as the `gitea` shim, and the worker git configuration points the Gitea host's credential helper at it (`gitea auth git-credential`).
