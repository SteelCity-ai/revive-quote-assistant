import { useEffect, useMemo, useRef, useState } from 'react';
import { History, RotateCcw, Camera } from 'lucide-react';
import type { Quote } from './domain';
import { money } from './domain';
import {
  captureSnapshot,
  compareQuotes,
  addSnapshot,
  MAX_SNAPSHOTS,
  type QuoteDiff,
  type QuoteSnapshot,
} from './history';

/**
 * Quote history panel (Q1 UI slice).
 * Bounded named checkpoints, line/scope/pricing diff view, restore-as-new-draft
 * with confirmation. Original quote is never mutated here.
 */

export default function QuoteHistory({
  quote,
  snapshots,
  onCapture,
  onRestore,
}: {
  quote: Quote;
  snapshots: QuoteSnapshot[];
  onCapture: (snapshot: QuoteSnapshot, updated: QuoteSnapshot[]) => string; // returns error ('' ok)
  onRestore: (snapshot: QuoteSnapshot) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [diffFor, setDiffFor] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const confirmedRef = useRef(false);

  const list = useMemo(() => [...snapshots].reverse(), [snapshots]); // newest first
  const confirmSnap = useMemo(
    () => snapshots.find((s) => s.id === confirmRestore) ?? null,
    [confirmRestore, snapshots],
  );

  // Open as a real modal: focus enters the dialog, Tab cycles inside it, and
  // Escape cancels via the browser's native dialog cancel/close path.
  useEffect(() => {
    if (confirmRestore && dialogRef.current && !dialogRef.current.open) {
      confirmedRef.current = false;
      dialogRef.current.showModal();
    }
  }, [confirmRestore]);

  const closeConfirm = (confirmed: boolean) => {
    confirmedRef.current = confirmed;
    dialogRef.current?.close();
  };
  // Native showModal makes the background inert but does not wrap Tab at the
  // dialog's edges, so the caret can land on <body>. Wrap the cycle here:
  // Tab on the last focusable moves to the first, Shift+Tab on the first moves
  // to the last. Escape/close behavior stays native and untouched.
  const trapDialogFocus = (e: React.KeyboardEvent<HTMLDialogElement>) => {
    if (e.key !== 'Tab') return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'),
    ).filter((el) => !el.hasAttribute('disabled'));
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const current = document.activeElement;
    if (e.shiftKey && current === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && current === last) {
      e.preventDefault();
      first.focus();
    }
  };
  const diff = useMemo(() => {
    if (!diffFor) return null;
    const snap = snapshots.find((s) => s.id === diffFor);
    return snap ? compareQuotes(snap.quote, quote) : null;
  }, [diffFor, snapshots, quote]);

  const capture = () => {
    const snapshot = captureSnapshot(quote, name);
    const error = onCapture(snapshot, addSnapshot(snapshots, snapshot));
    if (error) {
      setNote(error);
    } else {
      setNote(`Checkpoint “${snapshot.name || 'Unnamed'}” saved.`);
      setName('');
    }
  };

  return (
    <section className="history-panel" aria-label="Version history">
      <div className="history-head">
        <button ref={toggleRef} className="text-button" aria-expanded={open} onClick={() => setOpen(!open)}>
          <History size={16} /> {open ? 'Hide version history' : 'Version history'}
          <span className="history-count"> ({snapshots.length}/{MAX_SNAPSHOTS})</span>
        </button>
      </div>
      {open && (
        <div className="history-body">
          <div className="history-capture">
            <label className="field">
              <span>Checkpoint name (optional)</span>
              <input
                type="text"
                value={name}
                maxLength={80}
                placeholder="e.g. Before tile allowance change"
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <button className="secondary" onClick={capture}>
              <Camera size={16} /> Save checkpoint
            </button>
          </div>
          {note && (
            <p role="status" className="fine-print">
              {note}
            </p>
          )}
          {list.length === 0 ? (
            <p className="fine-print">
              No checkpoints yet. Save one before making big changes so you can compare or recover
              the earlier version.
            </p>
          ) : (
            <ul className="history-list">
              {list.map((snap) => (
                <li key={snap.id} className="history-item">
                  <div className="history-item-head">
                    <strong>{snap.name || 'Unnamed checkpoint'}</strong>
                    <small>{new Date(snap.createdAt).toLocaleString()}</small>
                  </div>
                  <div className="history-item-actions">
                    <button
                      className="text-button"
                      aria-expanded={diffFor === snap.id}
                      onClick={() => setDiffFor(diffFor === snap.id ? null : snap.id)}
                    >
                      {diffFor === snap.id ? 'Hide changes' : 'Compare with current'}
                    </button>
                    <button
                      className="text-button"
                      onClick={(e) => {
                        triggerRef.current = e.currentTarget;
                        setConfirmRestore(snap.id);
                      }}
                    >
                      <RotateCcw size={14} /> Restore as new draft
                    </button>
                  </div>
                  {diffFor === snap.id && <DiffView diff={diff} />}
                </li>
              ))}
            </ul>
          )}
          <p className="fine-print">
            Checkpoints are stored on this device only ({snapshots.length} of {MAX_SNAPSHOTS}{' '}
            used). Restoring creates a brand-new draft — the current quote stays exactly as it is
            and the restored copy needs fresh approval.
          </p>
        </div>
      )}
      {confirmSnap && (
        <dialog
          ref={dialogRef}
          role="alertdialog"
          aria-labelledby="restore-confirm-title"
          className="history-confirm-dialog"
          onKeyDown={trapDialogFocus}
          onClose={() => {
            const confirmed = confirmedRef.current;
            const snap = confirmSnap;
            confirmedRef.current = false;
            setConfirmRestore(null);
            if (confirmed && snap) {
              // Restored copy becomes the active quote; focus moves to the
              // history panel so the user lands somewhere useful in the new view.
              onRestore(snap);
              toggleRef.current?.focus();
            } else {
              // Cancel/Escape returns focus to the activator, not to <body>.
              triggerRef.current?.focus();
            }
          }}
        >
          <div className="history-confirm">
            <h3 id="restore-confirm-title">Restore as new draft?</h3>
            <p>
              Restore this checkpoint as a brand-new draft? The current quote stays unchanged, and
              the restored copy will need fresh approval before it can be issued.
            </p>
            <button className="secondary" autoFocus onClick={() => closeConfirm(true)}>
              Restore as new draft
            </button>
            <button className="text-button" onClick={() => closeConfirm(false)}>
              Keep current quote
            </button>
          </div>
        </dialog>
      )}
    </section>
  );
}

function DiffView({ diff }: { diff: QuoteDiff | null }) {
  if (!diff) return null;
  const empty =
    !diff.lineChanges.length && !diff.scopeChanges.length && !diff.answerChanges.length &&
    !diff.quoteChanges.length && !diff.pricingChanges.length && !diff.totalChanges.length;
  return (
    <div className="history-diff" role="region" aria-label="Changes between checkpoint and current quote">
      {empty ? (
        <p className="fine-print">No differences — this checkpoint matches the current quote.</p>
      ) : (
        <>
          {diff.lineChanges.length > 0 && (
            <div>
              <h4>Lines</h4>
              <ul>
                {diff.lineChanges.map((l, i) => (
                  <li key={i} className={`diff-line diff-${l.kind}`}>
                    <span className="diff-kind">{l.kind}</span>{' '}
                    {l.kind === 'changed' && l.fromDescription ? (
                      <>
                        {l.fromDescription || '(empty)'} → {l.description || '(empty)'}
                      </>
                    ) : (
                      l.description || 'Unnamed item'
                    )}
                    {l.kind === 'changed' && l.from && l.to && (
                      <small>
                        {' '}
                        — {l.from.quantity} {l.from.unit} · mat {money(l.from.material)} · hrs{' '}
                        {l.from.hours} @ {money(l.from.rate)} → {l.to.quantity} {l.to.unit} · mat{' '}
                        {money(l.to.material)} · hrs {l.to.hours} @ {money(l.to.rate)}
                      </small>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {diff.scopeChanges.length > 0 && (
            <div>
              <h4>Scope text</h4>
              <ul>
                {diff.scopeChanges.map((s, i) => (
                  <li key={i} className="diff-entry">
                    <span className="diff-field">{s.field}</span>
                    <ValueChange from={s.from} to={s.to} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {diff.answerChanges.length > 0 && (
            <div>
              <h4>Job answers</h4>
              <ul>
                {diff.answerChanges.map((a, i) => (
                  <li key={i} className="diff-entry">
                    <span className="diff-field">{a.field}</span>
                    <ValueChange from={a.from} to={a.to} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {diff.quoteChanges.length > 0 && (
            <div>
              <h4>Quote details</h4>
              <ul>
                {diff.quoteChanges.map((c, i) => (
                  <li key={i} className="diff-entry">
                    <span className="diff-field">{c.field}</span>
                    <ValueChange from={c.from} to={c.to} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {diff.pricingChanges.length > 0 && (
            <div>
              <h4>Pricing settings</h4>
              <ul>
                {diff.pricingChanges.map((p, i) => (
                  <li key={i} className="diff-entry">
                    <span className="diff-field">{p.field}</span>
                    <ValueChange from={String(p.from)} to={String(p.to)} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {diff.totalChanges.length > 0 && (
            <div>
              <h4>Totals</h4>
              <ul>
                {diff.totalChanges.map((t, i) => (
                  <li key={i} className="diff-entry">
                    <span className="diff-field">{t.field}</span>
                    <ValueChange from={money(t.from)} to={money(t.to)} />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Readable old/new values: multiline text preserved, empty values called out. */
function ValueChange({ from, to }: { from: string; to: string }) {
  return (
    <div className="diff-values">
      <span className="diff-value diff-value-from">Before: {from === '' ? '(empty)' : from}</span>
      <span className="diff-value diff-value-to">After: {to === '' ? '(empty)' : to}</span>
    </div>
  );
}
