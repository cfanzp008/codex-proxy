# Dashboard Password Split Design

## Context

`server.proxy_api_key` currently has two responsibilities:

- It is the Bearer token required by proxy API routes such as `/v1/chat/completions`, `/v1/responses`, `/v1/messages`, and Gemini-compatible routes.
- It is also the password for the remote Dashboard login gate.

This coupling makes operational security awkward. A key distributed to API clients also unlocks the Dashboard, where account management, exports, settings, and update controls live.

## Goal

Add an optional Dashboard-only password while preserving existing behavior for current deployments.

The selected design is backwards compatible:

- If `server.dashboard_password` is configured, remote Dashboard login uses that password.
- If `server.dashboard_password` is not configured, Dashboard login continues to use `server.proxy_api_key`.
- API routes continue to accept only `server.proxy_api_key` or existing per-account proxy keys. They must not accept `server.dashboard_password`.

## Non-Goals

- Do not introduce hashed password storage in this version.
- Do not add multi-user Dashboard accounts.
- Do not redesign API key management.
- Do not require UI support in the first implementation. Manual configuration in `data/local.yaml` is enough.
- Do not change localhost bypass behavior in this version.

## Configuration

Add an optional nullable field under `server`:

```yaml
server:
  proxy_api_key: "api-client-key"
  dashboard_password: "dashboard-login-password"
```

Field semantics:

- `proxy_api_key` controls API authentication.
- `dashboard_password` controls Dashboard login only.
- Empty string should be treated like unset.
- If both are unset, Dashboard login remains disabled and API routes retain the existing unauthenticated behavior.

## Authentication Behavior

Dashboard login password resolution should use this order:

1. `server.dashboard_password`, when set to a non-empty string.
2. `server.proxy_api_key`, when set to a non-empty string.
3. No Dashboard login gate.

Dashboard gate activation should use the same effective Dashboard password. If either `dashboard_password` or `proxy_api_key` is configured, remote Dashboard requests require a valid `_codex_session` cookie.

The API route checks must remain keyed to `server.proxy_api_key` and account-level proxy keys. `dashboard_password` must not be passed into `AccountPool.validateProxyApiKey()` and must not be accepted by API routes.

## Affected Components

- `src/config-schema.ts`: add `server.dashboard_password`.
- `config/default.yaml`: document the default as `null`.
- `src/routes/dashboard-login.ts`: validate submitted Dashboard password against the effective Dashboard password.
- `src/middleware/dashboard-auth.ts`: gate remote Dashboard endpoints when an effective Dashboard password exists.
- `src/routes/admin/settings.ts`: keep existing API key behavior unchanged. Do not expose `dashboard_password` through the existing API key settings response in the first version.
- `README.md` and `README_EN.md`: document split credentials and examples.
- Tests around Dashboard auth and API auth should cover fallback and separation.

## Data Flow

Remote Dashboard access:

1. Browser loads `/`.
2. Frontend calls `/auth/dashboard-status`.
3. Server resolves effective Dashboard password.
4. If no effective password exists, status returns `required: false`.
5. If a password exists and the request is remote, status returns `required: true` unless a valid session cookie exists.
6. Login posts `{ password }` to `/auth/dashboard-login`.
7. Server compares the password to the effective Dashboard password and creates the existing cookie session on success.

API access:

1. Client calls `/v1/...` with `Authorization: Bearer <key>`.
2. Route checks the key using the existing API key path.
3. `dashboard_password` is ignored for API access.

## Error Handling

- Missing Dashboard password when a gate is not required should keep returning the current no-gate status.
- Incorrect Dashboard password should keep returning `401` and reuse the existing rate limit behavior.
- API calls using `dashboard_password` should return the same invalid API key error as any other bad key.

## Security Notes

This design improves credential separation but stores `dashboard_password` in plaintext, matching the requested operational model and current `proxy_api_key` behavior.

Operators should use different values for `proxy_api_key` and `dashboard_password`. Documentation should explicitly warn that reusing them defeats the separation.

If exposed through a reverse proxy or tunnel, `server.trust_proxy: true` may still be required so the Dashboard gate can correctly distinguish remote clients from localhost.

## Testing

Add or update tests for:

- No `dashboard_password`, `proxy_api_key` set: Dashboard login uses `proxy_api_key` as before.
- `dashboard_password` set, `proxy_api_key` set: Dashboard login accepts only `dashboard_password`.
- `dashboard_password` set, `proxy_api_key` set: API routes reject `dashboard_password` and accept `proxy_api_key`.
- `dashboard_password` set, `proxy_api_key` unset: Dashboard gate is enabled, API key enforcement remains unchanged from current behavior for unset `proxy_api_key`.
- Empty `dashboard_password` behaves as unset.

## Rollout

This is a backwards-compatible config addition. Existing deployments do not need to change anything. Users who want split credentials can add:

```yaml
server:
  proxy_api_key: "api-client-key"
  dashboard_password: "dashboard-login-password"
```

Then restart or reload the service through the existing deployment flow.
