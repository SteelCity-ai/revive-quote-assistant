# ADR 0001 — Client identity and concurrency isolation for public and admin limits

- Status: Accepted
- Date: 2026-11-09
- Issue: STE-386 (decision source STE-330)
- Scope: `revive-quote-assistant` server only. No portal change.

## Context

Three defects were confirmed at `1d2ea71`:

1. The public instant limit (3 per hour) keyed on `req.socket.remoteAddress`. In
   production the app binds `127.0.0.1:4182` behind Traefik, so every visitor
   arrives as the proxy address and shares one bucket.
2. A single module-level `let running = false` was the only generation slot for
   both `/api/instant/estimate` and `/api/ai/estimate`. One public estimate
   (240 s timeout) blocked every admin estimate.
3. The sign-in limit (10 attempts / 10 min) keyed on `req.socket.remoteAddress`,
   so one anonymous visitor could lock the office out of sign-in.

## Decision

### 1. Client identity

`server/identity.mjs` resolves a client address with a **loopback-gated,
rightmost-header** model:

- If the direct socket peer is **not** loopback, the socket address is used. The
  app binds loopback only in production (`BIND_HOST=127.0.0.1`, host network),
  so a non-loopback peer cannot occur there.
- If the peer **is** loopback and `X-Forwarded-For` is present, the **rightmost**
  valid IP entry is used. A proxy appends the address it observed to the end of
  the header, so the rightmost entry is the one the nearest proxy wrote; entries
  to its left may be client-supplied and are ignored.
- If the header is absent or malformed, the socket address is used.
- `TRUST_PROXY_HEADERS=false` disables header trust entirely and forces socket
  identity.

### 2. Proxy trust model — what was and was not proven

The deployed Traefik forwarded-header configuration could **not** be read from
the build environment: this task has no production access and the private SSH
endpoint (`root@100.82.54.127`) is unreachable from the build container. The
trust model is therefore **not proven from the deployed configuration**.

What *is* verifiable from the repository:

- `deploy/compose.yml` sets `BIND_HOST=127.0.0.1` and `network_mode: host`, so
  the service is reachable only from the host loopback interface.
- Traefik's documented default behaviour appends the observed client address to
  `X-Forwarded-For`; the rightmost entry is therefore proxy-written.

Residual risk: if the deployed proxy is configured to pass a client-supplied
`X-Forwarded-For` through without appending, the rightmost entry could be
spoofed. The impact is limited to a visitor bypassing their own rate limit; it
does not expose data or block other users. The global cost cap (below) remains
the backstop. **Operator action:** confirm the Traefik router for
`quote.reviverepairco.com` appends `X-Forwarded-For` before relying on per-client
limits; set `TRUST_PROXY_HEADERS=false` if it does not.

### 3. Per-purpose limit maps

Each purpose has its own sliding-window map, so exhausting one never affects
another:

- `publicWindows` — anonymous public instant estimates, 3 per hour per client.
- `adminWindows` — authenticated admin generation, 12 per hour per account.
- `roofWindows` — roof measurement, 30 per hour per client.
- `attempts` (portal) — sign-in, 10 per 10 minutes per **account + address**.

### 4. Separate concurrency slots

`slots.public` and `slots.admin` are independent. A public estimate in flight
never blocks an admin estimate, and vice versa.

### 5. Sign-in keyed by account plus address

The sign-in limit key is `<lowercased email>|<client address>`. An anonymous
visitor cannot consume the office account's bucket, because the office account
has its own key. The address component still limits repeated attempts against a
single account from one origin.

### 6. Global cost cap that never blocks admins

`GLOBAL_HOURLY_GENERATION_CAP` (default 200) bounds total generations per hour
across public and admin purposes. When the cap is reached, **public** requests
receive 429; **admin** requests are never blocked by the cap. This is a cost
backstop, not a fairness mechanism.

## Consequences

- Single instance only. A shared store across instances is R2 and out of scope.
- Per-client public limits depend on the proxy appending `X-Forwarded-For`; the
  limitation is recorded above and in `docs/DEPLOYMENT.md`.
- Regression tests cover shared-bucket exhaustion, public blocking admin, and
  anonymous sign-in lockout.
