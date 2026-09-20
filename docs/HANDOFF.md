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

Deployment evidence and Git commit IDs will be appended after release. A server health check does not prove the user's phone microphone, complete AI estimate accuracy or customer approval flow.

## Remaining work

1. Conversational voice: **Talk to Revive**, spoken questions, automatic end-of-turn detection, extracted/validated answers, corrections, spoken review and distinct confirmation. Nothing in the current UI implements voice yet; see the architecture acceptance notes.
2. Google roof measurement proposals and measurement provenance.
3. Cross-device draft storage and safe JSON import (existing exports are backups only).
4. Actual device/Bluetooth/background/network testing; do not assume hands-free capability from a browser mock.
5. Optional email/SMS delivery with recipient confirmation, audit history and retries.
6. Shared session/rate-limit store before scaling beyond one app instance; organization/user-separated draft storage for shared devices.
7. Reconcile newer live portal code and the separate safety-development checkout into the portal repository before the next portal deployment.
