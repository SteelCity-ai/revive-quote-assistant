import { useEffect, useId, useRef, useState, type SyntheticEvent } from 'react';
import type { JobType, Quote } from './domain';
import { jobNames } from './domain';
import { commitDraftImport, parseDraftImport, type ImportPreview } from './import';
import type { SavedState } from './storage';
import './DraftImport.css';

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MiB, matches the parser's payload cap

type Props = { current: SavedState; onImported: (next: SavedState) => void; onClose: () => void };

/** Map a quote to its job-type label. Rendered as React text only. */
function quoteLabel(quote: Quote): string {
  return jobNames[quote.type as JobType] ?? 'Unknown type';
}

export default function DraftImport({ current, onImported, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [selectedFileName, setSelectedFileName] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [importAsCopy, setImportAsCopy] = useState(false);
  const headingId = useId();
  const fileLabelId = useId();
  const fileHelpId = useId();
  const errorId = useId();
  const prevFocusRef = useRef<HTMLElement | null>(null);
  const ignoreNextCloseRef = useRef(false);

  // Show the native modal dialog on mount; restore prior focus on unmount.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    prevFocusRef.current = document.activeElement as HTMLElement | null;
    if (!dialog.open) dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
      const prev = prevFocusRef.current;
      if (prev && document.contains(prev)) prev.focus();
    };
  }, []);

  // Keyboard behavior: Escape calls onClose; Tab/Shift-Tab wrap inside the dialog.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusables = () => Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    );
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        ignoreNextCloseRef.current = true;
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === dialog)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    dialog.addEventListener('keydown', onKeyDown);
    return () => dialog.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function handleFile(file: File) {
    setBusy(true);
    setError('');
    setPreview(null);
    setImportAsCopy(false);
    setSelectedFileName(file.name);
    try {
      if (file.size > MAX_FILE_BYTES) {
        setError(`File is too large (${(file.size / 1024 / 1024).toFixed(1)} MiB). Maximum is 2 MiB.`);
        return;
      }
      const text = await file.text();
      setPreview(parseDraftImport(text, current.quotes));
    } catch (err) {
      setPreview(null);
      setError(err instanceof Error ? err.message : 'Could not read the file.');
    } finally {
      setBusy(false);
    }
  }

  function closeForParent() {
    ignoreNextCloseRef.current = true;
    const dialog = dialogRef.current;
    if (dialog && dialog.open) dialog.close();
    onClose();
  }

  function handleImport() {
    if (!preview || busy) return;
    setBusy(true);
    setError('');
    try {
      // Commit writes the complete new saved state once, before any UI state changes.
      const next = commitDraftImport(preview, current, { allowDuplicates: importAsCopy });
      onImported(next);
      closeForParent();
    } catch (err) {
      // App state untouched on failure: error is visible, preview stays for retry.
      setError(err instanceof Error ? err.message : 'Import failed. Existing data is unchanged.');
    } finally {
      setBusy(false);
    }
  }

  // Native dialog cancel (Escape-default or click-outside): always route to onClose once.
  function handleDialogCancel(e: SyntheticEvent<HTMLDialogElement>) {
    e.preventDefault();
    ignoreNextCloseRef.current = true;
    onClose();
  }
  // Native close event not initiated by this component: notify parent once.
  function handleDialogClose(e: SyntheticEvent<HTMLDialogElement>) {
    e.preventDefault();
    if (ignoreNextCloseRef.current) {
      ignoreNextCloseRef.current = false;
      return;
    }
    onClose();
  }

  const hasDuplicates = (preview?.duplicates.length ?? 0) > 0;
  const canConfirm = !!preview && !busy && (!hasDuplicates || importAsCopy);

  return (
    <dialog
      ref={dialogRef}
      className="draft-import"
      aria-labelledby={headingId}
      onCancel={handleDialogCancel}
      onClose={handleDialogClose}
    >
      <h2 id={headingId} className="draft-import__heading">Import draft quotes</h2>
      <p className="draft-import__intro">
        Import quotes from an exported drafts JSON file. Imported drafts arrive fresh and
        unapproved; approval history in the file is stripped. Your existing quotes and global
        pricing are not changed.
      </p>
      <label className="draft-import__file-label" htmlFor="draft-import-file" id={fileLabelId}>
        Drafts JSON file
      </label>
      <input
        id="draft-import-file"
        type="file"
        accept=".json,application/json"
        aria-describedby={fileHelpId}
        disabled={busy}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
        }}
      />
      <p id={fileHelpId} className="draft-import__help">JSON export, 2&nbsp;MiB max.</p>
      {selectedFileName && !error && !preview && !busy && (
        <p className="draft-import__selected">Selected: {selectedFileName}</p>
      )}
      {error && (
        <p className="draft-import__error" role="alert" id={errorId}>{error}</p>
      )}
      {busy && !preview && <p className="draft-import__loading" aria-live="polite">Reading file…</p>}

      {preview && (
        <section className="draft-import__preview" aria-label="Import preview">
          <h3 className="draft-import__preview-heading">Preview</h3>
          <ul className="draft-import__list">
            {preview.quotes.map((quote, i) => (
              <li key={i} className="draft-import__quote">
                <span className="draft-import__quote-name">{quoteLabel(quote)}</span>
                {preview.duplicates.includes(i) && (
                  <span className="draft-import__dup-flag">Duplicate of an existing quote</span>
                )}
                {quote.kind === 'fixed' && <span className="draft-import__quote-kind">Fixed price</span>}
                {preview.warnings[i] && (
                  <span className="draft-import__quote-warning">{preview.warnings[i]}</span>
                )}
              </li>
            ))}
          </ul>
          <p className="draft-import__notice">
            {preview.quotes.length} quote{preview.quotes.length === 1 ? '' : 's'} will be added as
            fresh, unapproved drafts. Approval history is stripped and global pricing is not changed.
          </p>
          {hasDuplicates && (
            <div className="draft-import__copy-block">
              <label className="draft-import__copy-check">
                <input
                  type="checkbox"
                  checked={importAsCopy}
                  onChange={(e) => setImportAsCopy(e.target.checked)}
                />
                Import as copy
              </label>
              <p className="draft-import__copy-help">
                This file duplicates existing quotes. To import anyway, choose “Import as copy”.
                Otherwise the Import button stays disabled.
              </p>
            </div>
          )}
        </section>
      )}

      <div className="draft-import__actions">
        <button
          type="button"
          className="draft-import__cancel"
          onClick={closeForParent}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="button"
          className="draft-import__import"
          onClick={handleImport}
          disabled={!canConfirm}
        >
          {busy ? 'Importing…' : 'Import'}
        </button>
      </div>
    </dialog>
  );
}
