// STE-104: snippet library UI — uses the exact STE-103 module API only.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Bookmark, Trash2, Plus, X, Search, Check } from 'lucide-react';
import { money } from './domain';
import type { Line } from './domain';
import {
  loadSnippets, saveSnippet, deleteSnippet, appendSnippetLines,
  searchSnippets, previewDuplicate, previewSnippet, findSnippet, findScopeMatches,
} from './snippets';
import type { Snippet, SnippetError } from './snippets';
import './scope-snippets.css';

const ERROR_TEXT: Record<SnippetError, string> = {
  'invalid-input': 'That snippet could not be saved — check the name and lines.',
  'quota-snippets': 'The snippet library is full (100 snippets). Delete one before saving another.',
  'quota-lines': 'Snippets are limited to 200 lines each. Save fewer lines.',
  'quota-storage': 'The snippet library is out of device space. Delete snippets to make room.',
  'corrupt-storage': 'Saved snippet data on this device is damaged and could not be read. Delete the library (Settings > clear site data) or export a backup before saving.',
  'storage-denied': 'This browser blocked device storage access for snippets. Allow site storage (or check private/incognito settings with storage blocked) and try again — no snippet data was changed.',
  'unsupported-version': 'Saved snippet data was made by a different version and could not be read.',
};

type PanelMode = 'closed' | 'save' | 'library';

// Pure focus-restore decision (unit-testable without a DOM renderer). On real
// close/unmount the dialog restores keyboard focus to the exact opener so the
// user keeps their position; if the opener was removed, fall back to a
// connected focusable element instead of leaving focus on <body>.
// The launcher stays mounted while the modal is open (inert), so the opener
// remains connected and is preferred over any global fallback.
export function resolveFocusRestore<T extends { isConnected: boolean }>(
  opener: T | null,
  fallback: T | null,
): T | null {
  if (opener && opener.isConnected) return opener;
  return fallback;
}

// Open-dialog focus invariant (F7): while the dialog is open after a render,
// keep keyboard focus inside the dialog. If focus is already inside (e.g. the
// user is typing in the library search box), preserve it and do nothing. Only
// when the previously focused child was removed (Save -> library panel change,
// or an item deleted while the library stays open) and focus fell outside to
// <body> should we refocus the first control inside the dialog.
export function shouldRefocusIntoDialog(dialogContainsActive: boolean): boolean {
  return !dialogContainsActive;
}

const snippetTotal = (lines: { quantity: number; material: number; hours: number; rate: number }[]) =>
  lines.reduce((s, l) => s + l.quantity * l.material + l.hours * l.rate, 0);

function Modal({ title, onClose, opener, launchRef, children }: {
  title: string;
  onClose: () => void;
  opener: HTMLElement | null;
  launchRef: React.RefObject<HTMLDivElement | null>;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Keep the latest onClose without re-running the focus/restore effect on every
  // parent or search render (the inline callback would otherwise re-focus and
  // jump the keyboard position while typing in the library search box).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // The exact element that opened the dialog, captured at click time in the
  // parent (the launcher stays mounted while the modal is open, so this remains
  // connected and is the precise Save/Library initiator, never <body>).
  const openerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    openerRef.current = opener instanceof HTMLElement ? opener : null;
    const el = ref.current;
    const focusable = el?.querySelector<HTMLElement>('input, button, select, textarea, [tabindex]:not([tabindex="-1"])');
    focusable?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onCloseRef.current(); return; }
      if (e.key === 'Tab' && el) {
        const items = [...el.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])')].filter(n => n.offsetParent !== null);
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        const active = document.activeElement;
        // Contain Tab when focus has fallen outside the dialog (e.g. a focused
        // control was removed during a panel change like Save -> library): the
        // first Tab should move focus back inside, not escape to the page.
        if (!active || !el.contains(active)) { e.preventDefault(); first.focus(); return; }
        if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      // On real close/unmount, restore keyboard focus to the exact opener so the
      // user keeps their position. The launcher div stays mounted (inert while
      // open), so the opener is still connected here; fall back only to the
      // launcher's first focusable control, never a global arbitrary element or
      // <body>.
      const launchFallback = launchRef.current?.querySelector<HTMLElement>('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])') ?? null;
      const target = resolveFocusRestore(openerRef.current, launchFallback);
      target?.focus();
    };
  }, []);
  // Guarded open-dialog focus invariant: after every render, keep keyboard
  // focus inside the dialog. If focus is already inside (e.g. the user is
  // typing in the search box and the panel re-renders), do nothing so we never
  // steal it. If the previously focused child was removed during a panel change
  // (Save snippet -> library) and focus has fallen outside to <body>, move it
  // back to the first appropriate control inside the dialog. This also covers
  // an item being deleted while the library stays open.
  useLayoutEffect(() => {
    const el = ref.current;
    const active = document.activeElement;
    // Only refocus when the dialog does NOT contain the active element (i.e.
    // focus fell outside during a panel change/item deletion). When focus is
    // already inside the dialog (search typing), preserve it — never steal it.
    if (!el || !shouldRefocusIntoDialog(!!active && el.contains(active))) return;
    const focusable = el.querySelector<HTMLElement>('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])');
    focusable?.focus();
  });
  return <div className="snippet-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="snippet-modal" role="dialog" aria-modal="true" aria-label={title} ref={ref}>
      <div className="snippet-modal-head"><h2>{title}</h2><button className="icon-button" aria-label="Close snippet dialog" onClick={onClose}><X size={18}/></button></div>
      {children}
    </div>
  </div>;
}

export default function ScopeSnippets({ lines, change }: { lines: Line[]; change: (lines: Line[]) => void }) {
  const [mode, setMode] = useState<PanelMode>('closed');
  // The launcher div stays mounted at all times so the modal's opener button
  // keeps its DOM identity (and stays connected) across open/close, letting
  // focus restore land on the exact Save/Library initiator.
  const launchRef = useRef<HTMLDivElement>(null);
  // The precise element that opened the dialog, captured at click time.
  const initiatorRef = useRef<HTMLElement | null>(null);
  const [snippets, setSnippets] = useState<Snippet[] | null>(null);
  const [loadError, setLoadError] = useState<SnippetError | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmAppendId, setConfirmAppendId] = useState<string | null>(null);
  const reload = () => {
    const r = loadSnippets();
    if (r.ok) { setSnippets(r.snippets); setLoadError(null); }
    else { setSnippets(null); setLoadError(r.error); }
  };
  useEffect(reload, []);

  const selectedLines = useMemo(() => lines.filter(l => selected.has(l.id)), [lines, selected]);
  const filtered = useMemo(() => snippets ? searchSnippets(snippets, query) : [], [snippets, query]);
  const preview = previewId ? findSnippet(previewId, snippets ?? []) : null;
  // STE-109 F4: compare the snippet pending append against CURRENT quote lines.
  const pendingAppend = confirmAppendId ? findSnippet(confirmAppendId, snippets ?? []) : null;
  const appendScopeMatches = pendingAppend ? findScopeMatches(pendingAppend, lines) : [];

  const openSave = () => {
    initiatorRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelected(new Set(lines.map(l => l.id)));
    setName('');
    setError('');
    setMode('save');
  };
  const openLibrary = () => {
    initiatorRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    reload(); setQuery(''); setNotice(''); setError(''); setMode('library');
  };

  const doSave = () => {
    if (!selectedLines.length) { setError('Select at least one line to save.'); return; }
    const dup = previewDuplicate({ name, lines: selectedLines }, snippets ?? []);
    const result = saveSnippet({ name, lines: selectedLines });
    if (!result.ok) { setError(ERROR_TEXT[result.error]); return; }
    reload();
    setMode('library');
    setNotice(dup ? `Saved “${result.snippet.name}”. Note: a snippet with the same name and lines already existed, so there may be a duplicate in the library.` : `Saved “${result.snippet.name}”. Captured prices and the saved date are a snapshot — always review them before reusing.`);
  };

  const doAppend = (id: string) => {
    const result = appendSnippetLines(id, lines);
    if (!result.ok) { setError(ERROR_TEXT[result.error]); setConfirmAppendId(null); return; }
    change(result.lines);
    setConfirmAppendId(null);
    setPreviewId(null);
    setMode('closed');
    setNotice('');
  };

  const doDelete = (id: string) => {
    const result = deleteSnippet(id);
    if (!result.ok) { setError(ERROR_TEXT[result.error]); setConfirmDeleteId(null); return; }
    reload();
    setConfirmDeleteId(null);
    setPreviewId(null);
    setNotice('Snippet deleted.');
  };

  return <>
    <div ref={launchRef} className="snippet-launch no-print" inert={mode !== 'closed'} aria-hidden={mode !== 'closed'}>
      <button className="secondary" onClick={openSave} disabled={!lines.length}><Bookmark size={16}/>Save lines as snippet</button>
      <button className="secondary" onClick={openLibrary}><Bookmark size={16}/>Snippet library</button>
      {notice && <p role="status" className="fine-print">{notice}</p>}
    </div>
    {mode !== 'closed' && <Modal
      title={mode === 'save' ? 'Save lines as a snippet' : 'Snippet library'}
      onClose={() => { setMode('closed'); setError(''); }}
      opener={initiatorRef.current}
      launchRef={launchRef}>
    {mode === 'save' && <>
      {error && <p role="alert" className="snippet-error">{error}</p>}
      <label className="field"><span>Snippet name</span>
        <input value={name} maxLength={120} placeholder="e.g. Bathroom rough-in allowance"
          onChange={e => setName(e.target.value)} aria-required="true"/>
      </label>
      {snippets !== null && previewDuplicate({ name, lines: selectedLines }, snippets) && name.trim() &&
        <p role="status" className="fine-print">A snippet with this name and these exact lines already exists — saving will create a duplicate copy.</p>}
      <fieldset className="snippet-pick"><legend>Select lines to save ({selectedLines.length} of {lines.length})</legend>
        {lines.map((l, i) => <label key={l.id} className="snippet-pick-row">
          <input type="checkbox" checked={selected.has(l.id)}
            onChange={e => { const next = new Set(selected); if (e.target.checked) next.add(l.id); else next.delete(l.id); setSelected(next); }}/>
          <span className="snippet-pick-desc"><span className="line-number">{String(i + 1).padStart(2, '0')}</span> {l.description || 'Unnamed item'}</span>
          <span>{l.unit === 'exclusion' ? '—' : money(l.quantity * l.material + l.hours * l.rate)}</span>
        </label>)}
        <div className="snippet-pick-actions">
          <button className="text-button" onClick={() => setSelected(new Set(lines.map(l => l.id)))}>Select all</button>
          <button className="text-button" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      </fieldset>
      <p className="fine-print">Saved snippets capture these exact quantities and prices plus today’s date. Prices are not updated later — always review them before appending to a new quote.</p>
      <div className="snippet-modal-actions">
        <button className="primary" onClick={doSave} disabled={!name.trim() || !selectedLines.length}><Check size={16}/>Save snippet</button>
        <button className="text-button" onClick={() => setMode('closed')}>Cancel</button>
      </div>
    </>}
    {mode === 'library' && <>
      {loadError && <p role="alert" className="snippet-error">{ERROR_TEXT[loadError]}</p>}
      {error && <p role="alert" className="snippet-error">{error}</p>}
      <label className="field snippet-search"><span className="sr-only">Search snippets</span>
        <span className="snippet-search-icon" aria-hidden="true"><Search size={16}/></span>
        <input type="search" value={query} placeholder="Search snippets by name or line text"
          onChange={e => setQuery(e.target.value)} aria-label="Search snippets"/>
      </label>
      {snippets !== null && !snippets.length && <p className="snippet-empty">No snippets saved yet. Use “Save lines as snippet” in the line editor to create your first one.</p>}
      {snippets !== null && snippets.length > 0 && !filtered.length && <p className="snippet-empty">No snippets match “{query}”.</p>}
      <ul className="snippet-list">
        {filtered.map(s => <li key={s.id} className="snippet-item">
          <div className="snippet-item-head">
            <div>
              <strong>{s.name}</strong>
              <small>{s.lines.length} line{s.lines.length === 1 ? '' : 's'} · saved {new Date(s.savedAt).toLocaleDateString()} · {money(snippetTotal(previewSnippet(s)))}</small>
            </div>
            <div className="snippet-item-actions">
              <button className="text-button" aria-expanded={previewId === s.id} onClick={() => setPreviewId(previewId === s.id ? null : s.id)}>{previewId === s.id ? 'Hide preview' : 'Preview'}</button>
              <button className="secondary" onClick={() => setConfirmAppendId(s.id)}><Plus size={14}/>Append</button>
              <button className="icon-button" aria-label={`Delete ${s.name}`} onClick={() => setConfirmDeleteId(s.id)}><Trash2 size={15}/></button>
            </div>
          </div>
          {previewId === s.id && <div className="snippet-preview">
            {preview?.lines.map((l, i) => <div key={i} className="snippet-preview-row"><span>{l.description}<small>{l.quantity} {l.unit} · material {money(l.quantity * l.material)} · labor {money(l.hours * l.rate)}</small></span><strong>{l.unit === 'exclusion' ? '—' : money(l.quantity * l.material + l.hours * l.rate)}</strong></div>)}
          </div>}
          {confirmDeleteId === s.id && <div className="snippet-confirm" role="alertdialog" aria-label={`Confirm delete ${s.name}`}>
            <p>Delete “{s.name}” permanently? This cannot be undone.</p>
            <button className="danger" onClick={() => doDelete(s.id)}>Delete snippet</button>
            <button className="text-button" onClick={() => setConfirmDeleteId(null)}>Keep it</button>
          </div>}
          {confirmAppendId === s.id && <div className="snippet-confirm" role="alertdialog" aria-label={`Confirm append ${s.name}`}>
            <p>Append “{s.name}” to the end of this quote’s lines? Its saved prices and the saved date are a snapshot — review every appended line before approving.</p>
            {appendScopeMatches.length > 0 && <div className="snippet-confirm-warning" role="alert">
              <strong>Possible duplicate scope</strong>
              <p>{appendScopeMatches.length === 1
                ? `1 existing line in this quote matches a line in “${s.name}” (same description and unit). Appending could create a duplicate.`
                : `${appendScopeMatches.length} existing lines in this quote match lines in “${s.name}” (same description and unit). Appending could create duplicates.`} Review before continuing.</p>
            </div>}
            <button className="primary" onClick={() => doAppend(s.id)}>Append {s.lines.length} line{s.lines.length === 1 ? '' : 's'}</button>
            <button className="text-button" onClick={() => setConfirmAppendId(null)}>Cancel</button>
          </div>}
        </li>)}
      </ul>
      {notice && <p role="status" className="fine-print">{notice}</p>}
    </>}
    </Modal>}
  </>;
}
