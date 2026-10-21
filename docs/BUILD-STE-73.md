
## Q1-A11Y-1 follow-up (audit finding)
Restore confirmation converted from inline `role=alertdialog` div to a real modal `<dialog>` opened via `dialog.showModal()` (src/QuoteHistory.tsx, styles in src/styles.css).
- Focus enters the dialog on open (Confirm button autofocus); Tab/Shift+Tab stay inside via native modal focus containment.
- Escape cancels via the browser's native dialog cancel path (`cancel` → `close`); Cancel/Escape returns focus to the exact "Restore as new draft" trigger button.
- Confirm closes the dialog, restores the fresh unapproved draft (original untouched), and moves focus to the "Version history" toggle in the new view — a useful landing point, not `<body>`.
- Accessible label preserved: `role="alertdialog"` + `aria-labelledby` heading "Restore as new draft?". Question text unchanged.
- Styles: dialog card/backdrop sized for 390/768/1440; buttons full-width on small screens.
- No new dependencies; no money/storage/approval logic touched; restore sanitization unchanged.

### Keyboard verification guidance (for root/Han browser check)
1. Open history, save a checkpoint, click "Restore as new draft" → dialog opens; `document.activeElement` must be the dialog's Confirm button (inside dialog).
2. Press Tab repeatedly → focus cycles only within dialog (Confirm ↔ Cancel, plus heading/paragraph skipped). Shift+Tab likewise.
3. Press Escape → dialog closes, no restore occurs, focus returns to the "Restore as new draft" trigger that opened it.
4. Click Cancel ("Keep current quote") → same focus return, no restore.
5. Press Enter on Confirm → new draft quote becomes active; original quote unchanged; focus lands on the "Version history" toggle in the new view.
6. Repeat at 390px, 768px, 1440px — dialog fits viewport, buttons tappable, no horizontal overflow.

### Checks at this slice
- `npx tsc --noEmit` clean; `npm run build` clean.
- Full `npm test`: 15 files / 143 passed (no test changes needed; behavior verified by browser keyboard instructions above).
- Commit/push: 05c71a62ff4733dc6564bbc5f0a0d7b0c1e2dcd1 on codex/STE-73 (PR #6 updated).
