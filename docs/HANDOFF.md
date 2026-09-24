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
- **Public DNS/TLS complete:** on 2026-09-20 (EDT), quote.reviverepairco.com resolved through Cloudflare and normal public HTTPS returned HTTP 200. Direct-origin HTTPS with hostname/SNI validation also returned the expected release health response without disabling certificate verification. The origin certificate is issued by Let's Encrypt (YR2), expires 2026-12-20, and covers quote.reviverepairco.com. Only the quote router was reloaded to retry issuance after DNS propagated; its rule now includes PathPrefix(`/`). Use Cloudflare Full (strict) encryption. Public mobile login rendered correctly with no console errors; anonymous AI generation returned 401.
- Final real-user smoke test still needed by the user: sign in on a phone with an existing portal administrator account, prepare/review an estimate, save it, and inspect the pending project/PDF. Do not create customer acceptance evidence unless the customer actually accepted.

## Release evidence — 2026-09-21 (EDT)

- Application release commit/image: `9574fe7bc9d437040275f126de61e3c4120df7bc`. GitHub Actions run `35662931786` passed, including 60 tests, the TypeScript/Vite production build, production dependency audit and Docker build.
- The production container is healthy on loopback 4182 and public HTTPS. `/healthz` reports `9574fe7bc9d437040275f126de61e3c4120df7bc`; `/api/app/config` reports `voiceAvailable: true` and `roofMeasurementAvailable: true`.
- The live image's Google integration resolved `4200 Derry St, Harrisburg, PA 17111` and returned a 95,914 sq ft sloped roof proposal from high-quality 2024-05-02 imagery. It reported 91% ground-footprint coverage and the required partial-coverage/manual-confirmation warning. This provider check bypassed the authenticated browser route and created no quote or portal record.
- The live image's OpenAI Realtime configuration successfully minted a short-lived `gpt-realtime-2.1` client secret. No permanent credential was exposed. This verifies server access, not microphone, speaker, WebRTC audio quality or a complete conversation on a physical phone.
- Public 390 px browser verification passed without horizontal overflow or console errors. Anonymous voice and roof requests returned 401, an invalid origin returned 403, and production headers allow only same-origin microphone access plus the required OpenAI Realtime connection.
- The container remains nonroot/read-only with its previous 512 MiB, 1 CPU and 128 PID limits. Release `0150562d44ba7e2cb716b4a9b09813cb37e15728` remains available for rollback.

## Remaining work

1. Conversational voice is merged and deployed. Server-side Realtime access, route security, duplicate-call protection and synchronized quote context are verified. Complete a real authenticated conversation on physical iPhone and Android devices, including microphone permission, interruption, correction, pause/resume, typed fallback, estimate generation and revision-tied approval. Bluetooth, cellular network loss, speaker switching and background/screen-lock behavior remain unverified.
2. Google roof measurement is merged and deployed. The configured key and corrected Geocoding/Solar requests work from the production image, including partial-coverage provenance. Complete an authenticated browser test from the quote guide and compare several returned commercial roof areas with field measurements or trusted aerial reports before using them as final quantities.
3. Reconcile newer live portal code and the separate safety-development checkout into the portal repository before the next portal deployment.
4. Cross-device draft storage and safe JSON import (existing exports are backups only).
5. Actual device/Bluetooth/background/network testing; do not assume hands-free capability from a browser mock.
6. Optional email/SMS delivery with recipient confirmation, audit history and retries.
7. Shared session/rate-limit store before scaling beyond one app instance; organization/user-separated draft storage for shared devices.
8. Quote accuracy tracking: specified in [ACCURACY-SPEC.md](ACCURACY-SPEC.md) (portal-owned actuals, manual entry on closed projects, MAPE/bias reporting once ~10 jobs close). Phase 1 (data collection) is the recommended starting point when the portal team has capacity.
9. TypeSafe Jev is implemented only for optional voice intent/confidence routing and pause recovery. It is excluded from the estimate flow and every consequential action. Production needs a server-only `TYPESAFE_API_KEY` before `/api/app/config` will report `jevAvailable:true`; voice continues without it.
