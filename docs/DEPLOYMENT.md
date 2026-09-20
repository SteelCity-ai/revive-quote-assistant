# VPS deployment

## Layout

- Public: `https://quote.reviverepairco.com`
- VPS public IPv4: `187.77.6.198`; private SSH: `root@100.82.54.127`.
- Repository: `SteelCity-ai/revive-quote-assistant` (private).
- Release directories: `/docker/revive-quote-assistant/releases/<git-sha>`.
- Private environment: `/docker/revive-quote-assistant/shared/.env` (root, mode 600).
- Docker image: `revive-quote-assistant:<git-sha>`; service/container: `revive-quote-assistant`.
- Node binds only `127.0.0.1:4182`, on host networking. Traefik terminates TLS on 443 and forwards to this loopback service. No public dev server.
- Headroom: `http://100.82.54.127:8877/v1`, private dashboard `/dashboard`.

## Release procedure

1. Fetch the intended commit, verify tests/build/production audit and archive exactly the tracked source. Never upload node_modules, local environment files or artifacts as source.
2. Transfer the source archive by SSH, extract into a new release directory and build the tagged Docker image. Retain the previous image and compose settings.
3. Put server credentials in the private environment file via a protected channel; never echo them or include them in command-line arguments. The compose file overrides production origin, upstream URLs and loopback port.
4. Run the image as a temporary staging container on loopback 4183 with production settings. Check `/healthz`, `/api/app/config`, static assets, anonymous AI denial, and portal capability connectivity. Stop the temporary container after verification.
5. From the verified release directory, run `RELEASE_SHA=<sha> docker compose -p revive-quote-assistant -f deploy/compose.yml up -d`. This deployment does not restart portal, PostgreSQL, Traefik or Headroom.
6. Back up `/docker/traefik/dynamic.yml`, add only the `revive-quote-assistant` router/service pointing to `http://127.0.0.1:4182`, and retain all other routes. Router rule: Host(`quote.reviverepairco.com`), entrypoint websecure, TLS resolver letsencrypt.
7. DNS: A record `quote` → `187.77.6.198`, DNS-only initially. Remove a conflicting AAAA record unless IPv6 routing is explicitly configured. Verify DNS publicly and wait for a valid Let's Encrypt certificate.
8. Verify HTTPS `/healthz` returns the expected release SHA, the mobile sign-in page loads, anonymous generation is denied and the real administrator can sign in. A configured-key flag is not a provider test; check a small real AI call and Headroom counters separately without customer data.

## Rollback and state

If health fails, sessions break or generation errors regress after a release, set `RELEASE_SHA` to the last known-good image and run compose from the matching release directory. Do not remove shared secrets, portal tables, estimates, PDFs or projects. First-release rollback can stop only this new quote container and remove only its new Traefik router/service. Keep the source/image for diagnosis. Server restarts sign users out; local drafts and portal records remain intact.

Drafts are browser localStorage; encourage JSON export before clearing browser storage or changing origin. The move from localhost to the public domain does not move existing local drafts. There is no JSON import UI yet. Portal-approved records remain in the portal database and its backup process. This app has no independent database migration or persistent server data volume.

Do not deploy the portal from an older Git checkout as part of this release. On 2026-09-20 live portal quote tables and authenticated capabilities were already verified. Reconcile live portal changes with its dedicated development team before a future portal release.
