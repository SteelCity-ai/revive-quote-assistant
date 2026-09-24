# Base app verification

> Historical local-build record. The current production release and verification boundaries are maintained in [HANDOFF.md](HANDOFF.md). As of the pre-release check on 2026-09-23, production reports `17ae78192b6ea39f8d28a1dea71466c3ff672b69` with portal integration, Google roof measurement and conversational voice enabled. Statements below that the app is local-only or these integrations are future work describe earlier checkpoints and are superseded.

## AI integration verification — September 5, 2026

This addendum supersedes the earlier base-app statement that AI and price research were unimplemented.

- A real synthetic 400 sq ft Harrisburg office flooring request completed in 49 seconds through the private API and Headroom. The final pipeline returned 7 priced lines, 4 material entries, 19 citations and 7 separately labeled component cost guides. Three cost lines were AI-read published prices; four were allowances. No exact full-scope documented local project was found, so no comparable full-project range was invented. Local supplier prices were unavailable; selected products used online listings, with one unverified prep allowance. This is functional validation, not independent certification of product suitability, rates or estimate accuracy.
- Research uses GPT-4.1 and final estimating uses GPT-5.4 mini. Two independent live research requests cover products and project/labor benchmarks, followed by structured estimation. Earlier failed runs exposed material-index errors; material details are now nested with costs and assigned indices by the server. Missing supplier details are explicitly unverified, never silently associated with another item.
- All 21 tests passed. Production TypeScript/Vite build passed: approximately 256 kB JavaScript (79 kB gzip). Lockfile includes zod 3.25.76. Browser bundle secret-marker scan passed; private `.env.local` is absent from the Google Drive source copy.
- gstack UI checks replayed the captured successful live API response to avoid repeated billed generation. Verified generated line/material/source counts, edited material cost persistence, price-comparison classification, provider-error preservation, cancellation preservation and return to the quote. No console errors. No horizontal overflow at 320, 390 or 1440 px. Screenshots inspected on mobile and desktop layouts.
- Live generation itself was validated for one small flooring scope. Roofing/renovation guide and arithmetic coverage remain in the base tests; real AI pricing accuracy across those trades still needs field validation against completed Revive jobs.
- Current artifacts in the local workspace: `live-ai-result.json`, `ai-tests.json`, `ai-mobile-final.png`, `ai-desktop-final.png`, and browser QA scripts. Synthetic test records were confined to the separate QA browser and its prior storage restored after checks.
- App and API remain local on 4178 and 4180; no commit, push, public deployment or portal mutation. Physical phone connectivity is not verified. Portal sync, Google roof measurement, voice, attachments and message delivery remain pending.

## Earlier base-app results

Verified September 5, 2026, using the local C: working copy. The source and lockfile are also saved under `G:\My Drive\Revive\QuoteAssistant`.

## Automated checks

- Production TypeScript/Vite build passed: 243.84 kB JS (75.29 kB gzip), 22.54 kB CSS (5.40 kB gzip).
- All 9 Vitest tests passed. Coverage includes conditional trade/roof questions, invalid/unknown measurements, pitch and waste calculation, avoiding double pitch correction, labor arithmetic, fixed-quote missing terms, and per-quote defaults.
- gstack browser UI walkthroughs passed for roofing, renovation and contracting. The scripts interacted with rendered controls and native input/change events, and checked displayed state and persisted drafts.
- Roofing: 1,200 sq ft footprint at 6:12, 10% waste → 1,476 material sq ft and 1,342 tear-off sq ft. Entered test prices → $6,433.10 total. Approval saved successfully.
- Reload retained approval and answers. Editing pricing invalidated approval.
- Renovation selected Electrical and Plumbing only; the guide asked both and produced two lines. Unknown plumbing scope remained visible and blocked fixed-quote approval. Preliminary approval with acknowledgement worked.
- Contracting selected Flooring only, produced one line, and approved a fixed quote after terms and exclusions were entered.
- No browser console errors during the successful walkthroughs.
- 320x740, 390x844 and 1440x1000 viewports: no horizontal overflow. No actual physical phone was used.
- PDF produced through gstack's allowed CDP `Page.printToPDF` operation: two nonempty pages; pypdf confirmed customer name, $6,433.10 total and APPROVED state, with app editing controls excluded. The gstack `pdf` convenience command reset its browser, so direct CDP was used successfully. PDF raster inspection was not performed because PyMuPDF is unavailable; the customer preview was visually inspected in the browser screenshot.

## Visual inspection

Generated concept and implementation screenshots were inspected with `view_image`. The implementation was faithfully checked against the concept's main layout and visual system, with the intentional adaptations recorded in `DESIGN.md`.

Comparison points: white mobile canvas, navy typography, teal selected row/action, three full-width job choices, genuine empty state, settings access and sticky bottom action. Above-the-fold heading, helper and three job labels/descriptions match the concept. Header uses the documented wordmark/icon adaptation. At 320px, intentional text wrapping preserves readability; desktop adds the documented second column. No material unrecorded mismatch remained in the inspected screens.

Artifacts are in `C:\Users\mike\.codex\workspaces\revive-quote-assistant\artifacts`: `home-mobile.png`, `home-small.png`, `home-desktop.png`, `review-mobile.png`, `fixed-review-mobile.png`, `quote-test.pdf`, and the browser QA scripts. QA customer records were removed from the test browser after successful runs.

## Delivery limits

The app is running locally on port 4178. It is not publicly deployed. The same-network phone address is `http://192.168.40.99:4178`; physical phone/firewall access remains unverified. Device/browser storage is the current persistence layer. Connected AI, price research, portal sync, automatic roof measurements, voice, attachments and messaging remain future implementation work, explicitly described in the app.

The canonical portal working tree remained clean. No portal service, database or production configuration changed. No Git commit or push was made for the new app.

---

# Production UAT phase — started 2026-09-22

## Baseline verification (all checked 2026-09-22, before any UAT change)

- GitHub main at `0f75158`, clean, CI green on `9574fe7` and `0f75158` (runs 35662931786, 35671728557).
- Public `https://quote.reviverepairco.com/healthz` → `{"status":"ok","version":"9574fe7bc9d437040275f126de61e3c4120df7bc"}`.
- Public `/api/app/config` → `requiresLogin:true, voiceAvailable:true, roofMeasurementAvailable:true`.
- Container `revive-quote-assistant` healthy on the running image `revive-quote-assistant:9574fe7…`.
- Rollback images retained on the VPS: `9574fe7…` and `0150562d…` (first production release).
- Real-key Solar check (from staging, 2026-09-21): geocoding + Solar both reachable through the app module; Empire State control measurement returned sloped area 55,771 sq ft, footprint 82,624 sq ft, covered 52,689 sq ft, coverage 64% → partial-coverage warning fired, imagery 2024-05-24 HIGH.

## UAT progress tracker

| # | Area | Status | Evidence |
|---|------|--------|----------|
| 1 | Real-device voice (iPhone Safari, Android Chrome, BT, Wi-Fi/cellular) | basic Android/iPhone voice reported working; pause-recovery retest pending | Owner test 2026-09-23; intermittent post-answer stall reproduced by report |
| 2 | Roof measurement vs trusted measurements (3 buildings) | awaiting trusted areas | — |
| 3 | Quote type: roofing (full flow incl. portal save) | pending user test | — |
| 4 | Quote type: renovation | pending user test | — |
| 5 | Quote type: contracting | pending user test | — |
| 6 | Estimate accuracy baseline (3 historical jobs) | awaiting approved historical data | — |
| 7 | Defects found/fixed during UAT | fixed locally; release verification pending | session-level call-ID dedupe, pending Google confirmation, deterministic recap gate, medium VAD + one-shot watchdog, optional Jev routing |

Rules in force during UAT: synthetic/internal test customers only; no customer acceptance evidence; no portal redeploy; Google-derived data kept minimal (no imagery or raw API payloads in PDFs); every reproducible defect gets a regression test + smallest-component fix + full suite + staging before any production deploy.

## Basics-first intake + Project Fee release (2026-09-23)

- App release 20a09a6e59f47c4d28ed2fb3d269cd54ffec6ad2 deployed; healthz reports SHA; config flags true.
- Roofing intake now 5 questions (customer, address, roofWork, roofSystem, roofArea); title/contact/schedule/permits/notes and the pitch/condition/details/access/waste block removed for roofing; waste defaults 10%.
- Project Fee: 10% of direct costs, in totals(), review PDF view, voice read-back; portal quoteTotals/PDF mirror it (portal commit 225e566, tests 8/8, deployed to revive-portal-prod-api).
- Project name derived as street address + work type; portal PLANNED project receives it via portalSnapshot.
- marketRange (low/mid/high, zip-grounded, mid-to-high bias) added to estimate research prompt + comparison tab.
- Portal approval: inline customer creation via POST /api/portal/clients (companyName/contact/email).
- App tests 71/71, tsc clean, build clean, audit 0 vulns; staging loopback gates passed before deploy.
- Rebased on 0e6ff86 (agent voice hardening + Jev routing); merged recap-block test; suite 71/71.
