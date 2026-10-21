# STE-88 checkpoint — Q1 draft version history

Branch: codex/STE-88 (worktree /data/.openclaw/revive-team/worktrees/STE-88)

- Existing `src/history.ts` (preserved from STE-73) provides: `QuoteSnapshot`, `MAX_SNAPSHOTS=20`, `captureSnapshot(quote, name)`, `addSnapshot(list, snap)`, `restoreSnapshot(snap)`, `compareQuotes(from, to)` returning `QuoteDiff { lineChanges, scopeChanges, pricingChanges, totalChanges }`. Money math reuses `domain.totals`.
- Remaining: versioned localStorage persistence in a SEPARATE key (`revive-quote-history-v1`, never touching `revive-quotes-v1`) with injectable storage/clock/ID, bounded shape validation, surfaced corrupt/unsupported/quota errors without erasing old data.
- Then: focused Vitest `src/history.test.ts` (fake storage + synthetic Quote): snapshot isolation, retention, diff, restore sanitization/new UUID/no portal/ai/approval metadata, storage error paths, legacy store untouched.
- No UI/App/Review changes in this slice.
