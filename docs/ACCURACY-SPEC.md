# Spec — Quote accuracy tracking (deferred until approved)

Status: proposed, not scheduled. Nothing here is implemented. Portal-side changes require the portal team per AGENTS.md.

## Goal

Turn the quote pipeline into a measurable one: record what jobs actually cost, compare against the approved quote revision, and report error rates so pricing assumptions (labor rate, markup, waste, AI-estimated allowances) can be corrected over time.

## Why not a classifier (Jev / TypeSafe)

Accuracy requires ground truth — real invoiced cost vs quoted price. Jev-1.13 is a typed classifier (noul/choice/score) with no world model of construction costs; it cannot produce accuracy percentages. It is deferred for this app and stays on the roadmap for the voice feature only (answer validation/confirmation gating), because that is calibrated-probability work. See the Jev section at the bottom.

## Ground truth model (portal-owned)

The portal owns quotes, revisions, projects and financial records — this app has no database and must not create parallel tables (ARCHITECTURE.md). Accuracy data therefore lives in the portal:

1. New portal table `sales_quote_actuals` (migration, portal repo):
   - `revision_id` → FK to `sales_quote_revision`, unique (one actual per revision, latest wins, edits create new rows, old rows retained for audit).
   - `final_cost_cents` — invoiced/contracted total. Integer cents. Never computed by AI.
   - `final_material_cost_cents`, `final_labor_cost_cents` — optional split.
   - `closed_at` — job completion date.
   - `recorded_by`, `notes` — who entered it and context (change orders, surprises).
2. Entry point: a portal project (the one created on quote approval) gains an "Record actual cost" action, visible only when the project reaches a completed/closed state. Manual entry by staff; nothing is inferred automatically.
3. No editing of the immutable quote revision. Actuals are separate, append-friendly records.

## Reporting

1. Portal endpoint `GET /quotes/accuracy?from=&to=&type=` (ADMIN only), returning per-revision rows: quoted total, actual total, variance dollars, variance percent, and the pricing settings snapshot recorded with the revision.
2. Quote Assistant (or the portal UI — portal preferred, it owns the data) renders:
   - Mean absolute percentage error (MAPE) overall and per job type / roof system.
   - Bias: are we consistently under or over (signed mean variance)?
   - Breakdown by assumption: quotes that used AI-estimated allowances vs listed-price lines.
3. Minimum sample guard: with fewer than ~10 closed jobs, show "not enough data" instead of percentages — early numbers would mislead.

## Phases

1. **Phase 1 — data collection only (the long pole).** Portal migration + the "Record actual cost" action + notes. Value compounds from the first closed job; reporting can lag.
2. **Phase 2 — reporting endpoint + simple accuracy page** once ≥10 closed jobs exist.
3. **Phase 3 (optional)** — feed observed bias back into pricing defaults in Quote Assistant Settings (e.g. suggested waste/labor-rate adjustments), always as suggestions the administrator accepts explicitly. Never auto-adjust pricing settings.

## Non-goals / rules

- No AI-generated "actuals", no scraping invoices automatically, no customer-facing display of accuracy stats.
- Variance is informational for staff; it does not retroactively change approved revisions.
- Portal team owns schema/endpoints; this app consumes them read-only through the existing bridge allowlist (add `GET quotes/accuracy` to the allowlist explicitly).

## Jev — deferred decision (recorded so it is not re-litigated)

TypeSafe Jev (`jev-1.13`, ~$0.00003/call, ~300ms, typed probabilities) was evaluated for use in this app on 2026-09-21 and **deferred**:

- Estimate flow already has deterministic validation (`src/domain.ts`) plus AI-report flags (`researchGaps`, unresolved questions) — Jev would duplicate that.
- It cannot measure estimate accuracy (see above); that is this spec's job.
- Future fit: the voice feature (validating/extracting spoken answers, gating confirmations by confidence). Revisit then.
- Integration note if adopted later: Headroom (the shared VPS relay) 404s on TypeSafe's decisions endpoint; the app server must call TypeSafe directly with a `TYPESAFE_API_KEY` in the shared env file, keeping it out of Git.
