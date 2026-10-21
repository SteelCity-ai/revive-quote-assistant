# BUILD-ISSUE.md — STE-89 Q1 UI integration

Worktree: /data/.openclaw/revive-team/worktrees/STE-89, branch codex/STE-89, from aef404049045698b78e749501635a5927a239c2c (origin/codex/STE-88).

## Scope (owned files only)
- src/QuoteHistory.tsx (new) — history panel: bounded list, capture with name, diff view, restore-as-new-draft with confirmation.
- src/Review.tsx — minimal wiring: render QuoteHistory, surface history storage errors.
- src/AIApp.tsx — minimal wiring: history state (load/save via history.ts), capture/restore handlers, restored quote added to home selection.
- src/styles.css / focused styles + focused tests if needed.

Not touched: history.ts, domain.ts, margin.ts, portal.ts, other agents' files.

## API used (pushed in STE-88, src/history.ts)
captureSnapshot, addSnapshot (MAX_SNAPSHOTS=20), restoreSnapshot, compareQuotes, loadQuoteHistory, saveHistory, QuoteDiff/LineDiff types.

## Plan
1. Read history.ts + App/Review props once (done).
2. Implement QuoteHistory.tsx per FRONTEND-QUALITY.md (mobile/keyboard/focus/empty states, design tokens).
3. Wire AIApp: history loaded once per quote, saved on capture with error surfaced (no silent overwrite).
4. Restore → new quote in home selection, cleared portal/AI/approval metadata (restoreSnapshot), original unchanged.
5. Run build/tests; interaction checks if preview available.
6. Commit/push codex/STE-89, draft PR vs codex/STE-88, record SHA.

## Status
- Worktree created and checked out at aef4040.
- Implementation in progress.
