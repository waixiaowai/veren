# `@veren/admin-auth-local`

Use when an admin deployment needs local accounts without an external identity
provider: it owns users, scrypt password hashes, browser sessions with absolute and
idle expiry, one-time API tokens, first-run setup, and the sign-in/user/token
routes; skip it when authentication must come from an external OIDC or LDAP
provider.

## Credentials

- Passwords are hashed with scrypt (`scrypt$<salt>$<key>`, 64-byte key, 16-byte
  salt) and verified with `timingSafeEqual`.
- Session and API-token secrets are stored only as SHA-256 hashes. The API token
  seed (`adm_…`) is returned once; only a 12-character prefix stays visible.
- Email uniqueness is enforced on the normalized (lower-case) address.

## Sessions

| Rule | Behavior |
|---|---|
| Absolute expiry | `createdAt + sessionDays` |
| Idle expiry | `lastSeenAt + idleHours` |
| Refresh throttle | `lastSeenAt` is written at most once a minute |
| Logout | Removes the session record |

Session cookies are `HttpOnly`, `SameSite=Lax`, and `Secure` when
`secureCookies` is true. The CSRF cookie is readable by design (double submit).

## Routes

| Method | Path | Audience | Permission |
|---|---|---|---|
| `GET`/`POST` | `/api/public/v1/setup` | public | — |
| `POST` | `/api/public/v1/login` | public | — |
| `POST` | `/api/admin/v1/logout` | admin | — |
| `GET` | `/api/admin/v1/me` | admin | — |
| `GET`/`POST` | `/api/admin/v1/users` | admin | `admin.users.manage` |
| `PATCH`/`DELETE` | `/api/admin/v1/users/:id` | admin | `admin.users.manage` |
| `GET`/`POST` | `/api/admin/v1/users/:id/tokens` | admin | `admin.tokens.manage` |
| `DELETE` | `/api/admin/v1/tokens/:id` | admin | `admin.tokens.manage` |

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `sessionDays` | `7` | Absolute session lifetime |
| `idleHours` | `12` | Idle expiry |
| `secureCookies` | `false` | Mark cookies `Secure` (enable behind TLS) |
| `passwordMinLength` | `8` | Password policy |
| `loginRateLimit.window` / `.max` | `60` / `10` | Sign-in attempts per email+ip |

## Anti-lockout

Deleting a user that holds `owner` while it is the last owner throws `LAST_OWNER`.
The role binding itself is protected by the `access` provider.

## Known limitations

- Email, session-hash and token-hash lookups are scans over the collection; that is
  acceptable for an embedded deployment and needs indexes on a SQL engine.
- No password reset, no email verification, no MFA, no account lockout beyond the
  in-process sign-in rate limit (which resets on restart and is per instance).
- Sessions are not listed or revoked from the UI beyond logout; revoking all
  sessions after a password change is not implemented.
- `setup` is open while no user exists and has no setup token or TTL; bind the
  admin profile to loopback and create the owner immediately after install.

## Tests

```bash
pnpm exec vitest run --root plugins/admin/providers/auth-local
```
