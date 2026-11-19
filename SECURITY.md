# Security audit

Last audited: November 2026, after the move to Prisma and user accounts. Scope: all application code, Docker setup and dependencies.

## Findings fixed

| # | Severity | Issue | Fix |
|---|---|---|---|
| 1 | High | SSRF filter blocked **all** IPv4 destinations: Node's `BlockList` matched IPv4 addresses against the IPv4-mapped IPv6 rule | IPv4 and IPv6 ranges are checked in separate lists, with unit tests |
| 2 | Medium | Destinations that resolve to private IPs were retried until `MAX_ATTEMPTS` | SSRF blocks are permanent failures and go straight to dead letters |
| 3 | Medium | A transform could copy the whole payload (`"$"`) thousands of times and exhaust memory | `"$"` is allowed once. Specs are capped at 10 KB and depth 10 |
| 4 | Medium | With open registration, one account could attach unlimited destinations and turn each webhook into a large outbound fan-out | Caps of 50 relays per user and 10 destinations per relay |
| 5 | Low | CSP `upgrade-insecure-requests` broke the UI over plain HTTP on a LAN address | Directive removed. Use HTTPS in production |

## Controls in place

**Accounts and sessions**
- Passwords: scrypt (N=32768, r=8, p=1) with a random 16-byte salt, 10–128 characters.
- Login: returns the same error and takes the same time (~70 ms) whether or not the email exists, by checking a dummy hash for unknown emails.
- Sessions: 256-bit random tokens, stored only as SHA-256 hashes. The cookie is `HttpOnly`, `SameSite=Strict`, and `Secure` in production. Sessions expire after `SESSION_TTL_DAYS`, logout deletes them on the server, and expired ones are purged hourly.
- CSRF: `SameSite=Strict`, plus a required `X-Requested-With: hookrelay` header on every state-changing request, including login and register. CORS is not enabled.
- Brute force: 10 requests per minute per IP on login and register.

**Tenant isolation**
- Every dashboard query filters by the signed-in user inside the database `WHERE` clause. Records are never fetched first and checked afterwards.
- Another user's ID returns `404`, exactly like a missing record. Tested for:
  - read, update, delete and rotate on relays and destinations;
  - event detail and event replay;
  - dead-letter replay, single and bulk;
  - stats and the event list filtered by another user's relay.
- Prisma's global `omit` keeps `passwordHash`, `inboundSecret` and `signingSecret` out of every query unless the query explicitly selects them.

**Webhook pipeline**
- **SSRF:** destination URLs are checked when created and again on every connection, so DNS rebinding is blocked. Private, loopback, link-local, metadata and reserved ranges are refused, redirects are not followed, and URLs with embedded credentials are rejected.
- **Ingest:**
  - 1 MB body limit and a per-IP rate limit.
  - Bodies containing null bytes are rejected.
  - Slugs carry 40 random bits, so ingest URLs can't be guessed.
  - Optional HMAC signature check, using a timing-safe comparison.
- **Stored data:** `Authorization`, `Cookie`, `X-Api-Key` and signature headers are dropped before events are saved. Payloads are never logged, Redis holds only IDs, and events are purged after `EVENT_RETENTION_DAYS`.
- **Validation:** DTOs reject unknown fields, route params must be UUIDs, and Prisma parameterizes all SQL, including its two raw queries.
- **UI:** dynamic content is rendered with `textContent` only, under a CSP that allows `script-src 'self'` and no inline scripts.
- **Container:** runs as a non-root user. In `docker-compose.yml`, Postgres and Redis are bound to 127.0.0.1 only, so other machines on the network cannot reach them.
- **Dependencies:** `npm audit --omit=dev` reports 0 vulnerabilities.

## Remaining risks and recommendations

1. **Open registration.** `ALLOW_REGISTRATION` defaults to `true` so the first user can sign up. On a private deployment, set it to `false` once your accounts exist.
2. **Email enumeration on sign-up.** Register returns `409` for an existing email, which is standard UX and is rate-limited. Login does not leak this.
3. **No password reset, email verification or 2FA.** Password reset needs an email provider, which this project does not include.
4. **Inbound signatures have no timestamp.** A captured signed request can be replayed unless the sender includes an idempotency key.
5. **Secrets are stored in plaintext in Postgres**, because HMAC needs the raw value. Use encryption at rest and restrict database access.
6. **Rate limits are per instance and per IP.** Set `TRUST_PROXY=true` behind a load balancer, and add edge rate limiting for public ingest.
7. **Development mode is the default.** Unless `NODE_ENV=production`, localhost destinations are allowed and the dev sink is on, so local testing works with no setup. The app logs a warning at startup when it runs this way. Production is protected by these guards:
   - The Dockerfile sets `NODE_ENV=production`.
   - Production refuses to start without `DATABASE_URL` (PostgreSQL) and `REDIS_URL`, and refuses SQLite.
   - The dev sink can't be enabled in production.

   Still never deploy without `NODE_ENV=production`.
8. **At-least-once delivery.** Receivers should dedupe on `X-HookRelay-Delivery-Id`.
