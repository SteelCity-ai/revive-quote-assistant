# Agent handoff — 2026-09-20

## Ownership

This repository owns the Quote Assistant frontend, estimating service and portal bridge. Local source: `C:\Users\mike\.codex\workspaces\revive-quote-assistant-repo`. Read `ARCHITECTURE.md` first. Original Google Drive and preview runtime folders are historical copies, not the source for future releases.

The portal repository owns authentication/customer/project data and the quote-to-SOW endpoints. Its last published main was `5bef93e` when inspected. Live portal source has additional fixes and is deployed from `/docker/revive-portal-production`, which is not a Git checkout. Another team's work remains in `C:\Users\mike\Documents\RevivePortalImplementation` with uncommitted changes. Preserve it; do not overwrite the live portal with the older published main. This task only adds architectural documentation to the portal repository.

## Implemented

- Mobile guided intake for renovation, roofing and general contracting.
- AI pricing, local-first material suggestions, sourced comparisons and editable costs.
- Existing portal administrator login and explicit customer selection.
- Approved estimate PDF/revision plus pending project; customer acceptance activates the same project and generates the SOW draft/PDF in the portal.
- Production static server, authenticated paid API requests, secure cookies, origin/body/usage limits, health endpoint and bounded Docker deployment.
- GitHub Actions for tests/build/production dependency audit/container build.

## Verification boundaries

Local tests cover domain math, research evidence/material mapping, approval retry identity, bridge restrictions, production sign-in/role checks, usage limits and asset handling. No test sends email/SMS or purchases anything. Production dependency audit reports no vulnerabilities at this checkpoint.

On 2026-09-20 the live portal health, existing quote tables and authenticated `/quotes/capabilities` returned success. Quote list was empty. This was read-only verification with a short-lived server-generated session; no production customer records were created. Full existing portal hardening/release work remains owned by the portal team.

Deployment evidence is below. A server health check does not prove the user's phone microphone, complete AI estimate accuracy or customer approval flow.

## Release evidence — 2026-09-20 (EDT)

- Application release commit/image: `0150562d44ba7e2cb716b4a9b09813cb37e15728`. It is pushed to private GitHub main. Subsequent documentation commits do not change this deployed application version.
- GitHub Actions passed at https://github.com/SteelCity-ai/revive-quote-assistant/actions/runs/35543640248 : 28 tests, TypeScript/Vite build, production dependency audit and Docker build. Production dependency audit found zero vulnerabilities.
- Container `revive-quote-assistant` is running and healthy on VPS loopback 4182. `/healthz` returns the application release SHA. Resource limits: 512 MiB, 1 CPU, 128 PIDs; nonroot/read-only runtime.
- Temporary staging on loopback 4183 was verified and then stopped/removed. Staging denied anonymous AI calls (401), hid environment paths (404), required production login and served compiled assets.
- A real synthetic roofing estimate through the production image's generation module and VPS Headroom completed in 29 seconds with 5 cost items, 4 material entries and 15 sources. It was not stored in the portal and created no project/customer. Shared Headroom total requests increased from 3537 to 3545 during this window (other applications also use that counter). A separate tiny response test returned the expected text with HTTP 200. The full test is pipeline evidence, not a real-user sign-in test or an independent estimate-accuracy evaluation.
- gstack browser checks verified the production login page at 390px and 320px, with no horizontal overflow at 320px and no console errors. Screenshot artifacts remain local/ignored.
- Portal health remained HTTP 200 after this deployment. No portal application replacement or database migration occurred. Portal architecture documentation was pushed as `a30727f`.
- Traefik has the new quote router/service only; existing entries were preserved. Backup: `/docker/revive-quote-assistant/backups/traefik-20260921-012919.yml`.
- **Public DNS/TLS is pending:** `quote.reviverepairco.com` returns NXDOMAIN. Add A record `quote` → `187.77.6.198` (DNS-only initially). Forced-address HTTPS routing returned the correct health/config with certificate checking disabled solely for routing diagnosis; this is NOT valid public TLS verification. Let’s Encrypt could not issue a certificate before DNS exists. After the record is published, verify normal HTTPS and retrigger only this router's certificate request if needed. Do not tell users to bypass certificate warnings.
- Final real-user smoke test still needed after DNS/TLS: sign in on a phone with an existing portal administrator account, prepare/review an estimate, save it, and inspect the pending project/PDF. Do not create customer acceptance evidence unless the customer actually accepted.

## Remaining work

1. Conversational voice: **Talk to Revive**, spoken questions, automatic end-of-turn detection, extracted/validated answers, corrections, spoken review and distinct confirmation. Nothing in the current UI implements voice yet; see the architecture acceptance notes.
2. Google roof measurement proposals and measurement provenance.
3. Cross-device draft storage and safe JSON import (existing exports are backups only).
4. Actual device/Bluetooth/background/network testing; do not assume hands-free capability from a browser mock.
5. Optional email/SMS delivery with recipient confirmation, audit history and retries.
6. Shared session/rate-limit store before scaling beyond one app instance; organization/user-separated draft storage for shared devices.
7. Reconcile newer live portal code and the separate safety-development checkout into the portal repository before the next portal deployment.
