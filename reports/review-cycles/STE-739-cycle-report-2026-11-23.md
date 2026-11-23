# STE-739 — quote-assistant review cycle, 2026-11-23

Bounded cycle. No merge, deployment, migration, credential, customer or production-data action.

## State found (read this cycle)

- Live Quote app `200` at `/healthz`, version `2cbf9a82bade03ce145d0ee4f2573befdf7e5013`; Portal untouched by this cycle.
- `origin/main` = `1d2ea71ab7f47984eee99d51f8d566357d5a00e5` (merge of audited Q3; tree identical to the deployed `2cbf9a8` source).
- All six approved campaign features are `passed`. `FEATURE-SPECS.json` holds exactly those six; no approved unimplemented feature and no `todo` implementation item exists.
- Open draft PRs #17, #19, #20, #21, #22, #23, #24, #25, #26, #27, #28, #29 are reviewed work waiting on merge decisions, not missing code. #26/#27 carry Han QA (`STE-632`, `STE-651`) and fail CI only at `npm audit`; #29 clears that gate and is green.
- Blocked, with named owners: `STE-664` Codex audit of PR #28 (Codex idle, task still blocked), `STE-665` NEO security review of the PR #28 identity/rate-limit changes (NEO runtime has been in `error` since 2026-11-19T14:03Z — operator repair, not an agent task), `STE-167/168/169` preserved holds.
- The build lane had no active item: the previous quote cycle was `STE-691` (zod bump, done 2026-11-20). Portal/marketing cycles ran since.

## Slice delivered this cycle

Deploy size is the one measurable product cost that no open PR addresses. The single built bundle made a phone on a weak signal download the whole editor, history, snippets and import code before the saved-quote list appeared.

| File | Change |
| --- | --- |
| `src/AIApp.tsx` | `Guide`, `Estimate`, `Review`, `Settings` and `DraftImport` now load through `React.lazy` behind one `Suspense` boundary with a `role="status"` placeholder. `Home`, `Header`, `Generating` and `VoicePanel` stay in the entry chunk. |
| `src/styles.css` | `.screen-loading` placeholder with the existing design tokens; no new colour, font or spacing scale. |

No change to quote data, pricing, approvals, storage keys, portal protocol, history, snippets or import validation. No dependency, lockfile or workflow change.

## Verification at this commit (clean worktree, `npm ci --include=dev`, unchanged lockfile)

Baseline at `1d2ea71` (`npm test`, `npm run build`):

- `vitest run` — 22 files, **228 passed, 0 failed**.
- `vite build` — 1611 modules, entry JS **369.19 kB / 111.28 kB gzip**, CSS 47.80 kB / 10.25 kB gzip.

After the change:

- `tsc -b` — exit 0.
- `vitest run` — 22 files, **228 passed, 0 failed**.
- `vite build` — exit 0, deferred chunks: `Review` 57.08/16.17, `Estimate` 13.33/4.29, `DraftImport` 12.38/4.67, `Guide` 6.97/2.87, `Settings` 4.28/1.81 (kB raw / kB gzip).
- Entry JS **276.12 kB / 86.41 kB gzip** — **−93.07 kB raw (−25.2%)**, **−24.87 kB gzip (−22.4%)** on first load. Entry CSS 41.54/9.04 plus a 3.41/1.11 Review-only stylesheet.
- Nothing tracked outside the two source files and this report; `node_modules`/`dist` untracked.

## Handoff

- **Han QA** (`a6f42800-7c3e-4ad6-a19c-2a079df29866`), parent STE-739, exact SHA below: loopback `vite preview` on an unused port, verify Home renders with no console/network error, each first navigation shows the loading placeholder then the screen, editor/history/snippets/import/print still behave, keyboard focus survives the lazy mount, desktop 1440 and mobile 390, and the built entry chunk matches the measured size.
- Not claimed: no merge, deploy, release acceptance, authenticated production check or live portal contact. Deferred chunks must not be read as a speed claim on a specific device; the measured number is transfer size of the first load.

## Next delivery action

Han returns PASS or numbered findings at this SHA. The merge queue (#26, #27, #29 then #28) remains a release-owner decision; NEO's broken runtime is the only agent-side blocker on the release candidate.

## In plain English

The quote app sent the entire program — all screens, the quote editor, the history and the snippet library — to the phone before the saved-quote list could appear. On a weak signal in a driveway, that is the slowest part of using it. I split the app so the phone first downloads only the list screen, and the other screens arrive when someone opens them. The first download is now about a quarter smaller (111 kB to 86 kB compressed), and all 228 automatic tests still pass. A tester is checking that every screen still opens properly on desktop and phone. Nothing is merged or deployed, and nothing is needed from you.

## F1 correction (after Han QA at e5c2607)

Han's acceptance at `e5c260745bdfa6b204cbfd21de2c135b78fadc3b` found one Low defect: `DraftImport` was rendered as `{importOpen&&…}` *after* `</Suspense>`, so the first "Import drafts" open showed no `Loading…` placeholder while the chunk downloaded.

Fix at `392ffbca9a8593ad0cf22b23c90bf3be37f2086f` (`codex/STE-739`): that render moved inside the existing `Suspense` boundary. One line, `src/AIApp.tsx` only. No change to lazy imports, chunk split, data, pricing, approval, storage, portal protocol, history, snippets or import validation.

Verification in the clean `STE-739` worktree with the branch lockfile:

- `npx tsc -b` exit 0.
- `npx vitest run` — 22 files, 228 passed, 0 failed.
- `npx vite build` exit 0; entry JS **276.12 kB / 86.41 kB gzip**, chunks unchanged (`Review` 57.08/16.17, `Estimate` 13.33/4.29, `DraftImport` 12.38/4.67, `Guide` 6.97/2.87, `Settings` 4.28/1.81).

Pushed with the protected helper to `codex/STE-739`. Remaining gate: Han re-runs check 5 (import placeholder) and check 8 (first-use chunk) at the new head. Not claimed: no merge, deploy, release acceptance or authenticated production check.
