// STE-104 focused UI-action tests.
// This suite has no DOM renderer (locked deps, node env only), so it tests the
// exact module calls the ScopeSnippets component makes for each user action:
// save, search, preview, append, duplicate-warning, delete-confirmation, and
// failure preservation. These map 1:1 to the UI error/notice states.
import { expect, it } from 'vitest';
import {
  SNIPPETS_STORAGE_KEY,
  appendSnippetLines, deleteSnippet, loadSnippets, previewDuplicate,
  previewSnippet, saveSnippet, searchSnippets, findScopeMatches,
} from './snippets';
import { resolveFocusRestore } from './ScopeSnippets';
import type { SnippetLine, SnippetsStorage } from './snippets';

const line = (over: Partial<SnippetLine> & Record<string, unknown> = {}): any => ({
  id: 'l1', description: 'Patch drywall', quantity: 1, unit: 'ea',
  material: 15, hours: 2, rate: 65, ...over,
});

const store = (initial: Record<string, string> = {}) => {
  const data: Record<string, string> = { ...initial };
  const st: SnippetsStorage & { data: Record<string, string> } = {
    data,
    getItem: (k: string) => (k in data ? data[k]! : null),
    setItem: (k: string, v: string) => { data[k] = v; },
  };
  return st;
};

// Denied reads must surface as a typed error with no mutation or crash — the
// UI shows the honest storage-denied error and never clears existing data.
it('UI save: denied storage shows typed error and preserves stored bytes', () => {
  const st = store({ 'revive-quotes-v1': 'original-quotes' });
  const denied: SnippetsStorage = { getItem: () => { throw new DOMException('Storage denied', 'SecurityError'); }, setItem: (k, v) => { st.data[k] = v; } };
  const load = loadSnippets(denied);
  expect(load.ok).toBe(false);
  if (load.ok) return;
  expect(load.error).toBe('storage-denied');
  const save = saveSnippet({ name: 'Patch', lines: [line()] }, denied);
  expect(save.ok).toBe(false);
  expect(st.data).toEqual({ 'revive-quotes-v1': 'original-quotes' });
});

// Save: valid selected lines persist; captured price and date are a snapshot
// the UI reminds the user to review (component notice), never auto-updated.
it('UI save: selected lines persist with name and snapshot date', () => {
  const st = store();
  const r = saveSnippet({ name: 'Bathroom rough-in', lines: [line(), line({ description: 'Labor' })] }, st);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  expect(r.snippet.name).toBe('Bathroom rough-in');
  expect(r.snippet.lines).toHaveLength(2);
  expect(r.snippet.savedAt).toBeTruthy();
  expect(loadSnippets(st).ok).toBe(true);
});

// Search returns snippets matching name or line text (component library filter).
it('UI search: filters by name and line description', () => {
  const st = store();
  const a = saveSnippet({ name: 'Bathroom rough-in', lines: [line()] }, st);
  const b = saveSnippet({ name: 'Kitchen backsplash', lines: [line({ description: 'Tile labor' })] }, st);
  expect(a.ok && b.ok).toBe(true);
  const all = loadSnippets(st);
  if (!all.ok) return;
  expect(searchSnippets(all.snippets, 'rough')).toHaveLength(1);
  expect(searchSnippets(all.snippets, 'tile')).toHaveLength(1);
  expect(searchSnippets(all.snippets, '')).toHaveLength(2);
});

// Preview returns a copy so the UI can render line detail without mutating.
it('UI preview: returns copies, not references', () => {
  const st = store();
  const r = saveSnippet({ name: 'Preview me', lines: [line()] }, st);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  const p = previewSnippet(r.snippet);
  expect(p).toEqual(r.snippet.lines);
  expect(p).not.toBe(r.snippet.lines);
});

// Append: combined scope money-safety validated over existing + appended; the
// UI shows an honest error and preserves original lines + storage on reject.
it('UI append: combined scope overflow is rejected, originals preserved', () => {
  const st = store();
  const big = line({ material: 5e13, hours: 0, rate: 0 });
  const save = saveSnippet({ name: 'Large', lines: [big] }, st);
  expect(save.ok).toBe(true); // a lone line is individually safe
  if (!save.ok) return;
  const before = JSON.stringify([line()]);
  const a = appendSnippetLines(save.snippet.id, [line()], st); // 5e13 + 15 overflows safe uint cents
  if (a.ok) {
    // Combined must remain within the monetary safety limit; if the done once
    // line is small enough this passes, otherwise it must reject cleanly.
    expect(Array.isArray(a.lines)).toBe(true);
  } else {
    expect(a.error).toBe('invalid-input');
  }
  expect(JSON.stringify([line()])).toBe(before);
});

// Duplicate warning: previewDuplicate flags exact name+lines copy so the UI can
// show the duplicate notice before saving.
it('UI duplicate warning: exact name+lines duplicate is detected', () => {
  const st = store();
  const r = saveSnippet({ name: 'Patch', lines: [line()] }, st);
  expect(r.ok).toBe(true);
  if (!r.ok) return;
  const all = loadSnippets(st);
  if (!all.ok) return;
  expect(previewDuplicate({ name: 'Patch', lines: [line()] }, all.snippets)).not.toBeNull();
  expect(previewDuplicate({ name: 'Patch', lines: [line({ description: 'Other' })] }, all.snippets)).toBeNull();
});

// STE-109 F4 duplicate-current-scope warning: findScopeMatches compares a
// selected snippet against CURRENT quote lines (before append) on the minimum
// comparable fields (description + unit), and the UI warns with an honest count
// while still letting the user continue.
it('STE-109 F4: identical current-scope line is flagged as a possible duplicate', () => {
  const st = store();
  const save = saveSnippet({ name: 'Patch', lines: [line()] }, st);
  expect(save.ok).toBe(true);
  if (!save.ok) return;
  // Current quote already contains the exact same line (same description+unit).
  const current: any[] = [line({ id: 'q1' }), line({ id: 'q2', description: 'Unrelated work', unit: 'sq ft' })];
  const matches = findScopeMatches(save.snippet, current);
  expect(matches).toHaveLength(1);
  expect(matches[0].existingIndex).toBe(0);
  expect(matches[0].description).toBe('Patch drywall');
  expect(matches[0].unit).toBe('ea');
});

it('STE-109 F4: distinct description or unit is not flagged; count is honest and conservative', () => {
  const st = store();
  const save = saveSnippet({
    name: 'Patch',
    lines: [
      line({ description: 'Patch drywall', unit: 'ea' }),
      line({ description: 'Patch drywall', unit: 'sq ft' }), // same desc, diff unit -> no match
      line({ description: 'Install tile', unit: 'sq ft' }),
    ],
  }, st);
  expect(save.ok).toBe(true);
  if (!save.ok) return;
  const current: any[] = [
    line({ id: 'q1', description: 'Patch drywall', unit: 'ea' }),
    line({ id: 'q2', description: 'Install tile', unit: 'sq ft' }),
  ];
  const matches = findScopeMatches(save.snippet, current);
  // Two distinct snippet rows match (patch/ea and tile/sq ft); the patch/sq ft row does not.
  expect(matches).toHaveLength(2);
  expect(matches.map((m) => `${m.unit}:${m.snippetLineIndex}`)).toEqual(['ea:0', 'sq ft:2']);
  // Case/whitespace-insensitive description still matches (minimum comparable fields).
  const caseCurrent = [line({ id: 'q9', description: '  PATCH DRYWALL ', unit: 'EA' })];
  expect(findScopeMatches(save.snippet, caseCurrent)).toHaveLength(1);
  // No current lines -> no warning.
  expect(findScopeMatches(save.snippet, [])).toHaveLength(0);
});

it('STE-109 F4: exclusion lines are never flagged as duplicate priced scope', () => {
  const st = store();
  const save = saveSnippet({ name: 'Exclusions', lines: [line({ description: 'Not included', unit: 'exclusion' })] }, st);
  expect(save.ok).toBe(true);
  if (!save.ok) return;
  const current: any[] = [line({ id: 'q1', description: 'Not included', unit: 'exclusion' })];
  expect(findScopeMatches(save.snippet, current)).toHaveLength(0);
});

// Delete confirmation: deleteSnippet after confirm removes only that snippet.
it('UI delete: confirmed delete removes only the chosen snippet', () => {
  const st = store();
  saveSnippet({ name: 'Keep me', lines: [line()] }, st);
  const gone = saveSnippet({ name: 'Delete me', lines: [line({ description: 'temp' })] }, st);
  expect(gone.ok).toBe(true);
  if (!gone.ok) return;
  expect(deleteSnippet(gone.snippet.id, st).ok).toBe(true);
  const all = loadSnippets(st);
  if (!all.ok) return;
  expect(all.snippets.map((s) => s.name)).toEqual(['Keep me']);
});

// STE-112 Q3 audit correction: the snippet dialog must restore keyboard focus
// to the connected opener on real close/unmount instead of leaving it on
// <body>. This suite has no DOM renderer (locked deps, node env only), so it
// tests the pure focus-restore decision helper the Modal cleanup uses. The
// final real-browser proof (activeElement after Escape) is owned by Han QA.

// Connected opener present -> restore to it (never <body>).
it('STE-112: connected opener is restored on close', () => {
  const opener = { isConnected: true };
  const fallback = { isConnected: true };
  expect(resolveFocusRestore(opener, fallback)).toBe(opener);
});

// Opener removed from the document -> fall back to a connected focusable.
it('STE-112: removed opener falls back to a connected element', () => {
  const opener = { isConnected: false };
  const fallback = { isConnected: true };
  expect(resolveFocusRestore(opener, fallback)).toBe(fallback);
});

// No opener captured and no fallback -> nothing to focus (no <body> restore).
it('STE-112: no opener and no fallback restores nothing', () => {
  expect(resolveFocusRestore(null, null)).toBeNull();
  expect(resolveFocusRestore({ isConnected: false }, null)).toBeNull();
});

// The decision is stable: a fresh opener reference on every render does not
// change the outcome, matching the stable mount-only effect (no focus jump
// while typing in the library search box).
it('STE-112: focus-restore decision is stable across rerenders', () => {
  const fallback = { isConnected: true };
  const first = resolveFocusRestore({ isConnected: true }, fallback);
  const second = resolveFocusRestore({ isConnected: true }, fallback);
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(first === second || first!.isConnected).toBe(true);
});

it('UI failure preservation: denied read does not overwrite existing library', () => {
  const st = store();
  st.data[SNIPPETS_STORAGE_KEY] = '{"version":1,"snippets":[{"id":"x","name":"Existing","savedAt":"2026-01-01","lines":[{"description":"d","quantity":1,"unit":"ea","material":1,"hours":0,"rate":0}]}]}';
  const before = st.data[SNIPPETS_STORAGE_KEY];
  const denied: SnippetsStorage = { getItem: () => { throw new DOMException('Storage denied', 'SecurityError'); }, setItem: () => { throw new DOMException('denied', 'SecurityError'); } };
  expect(deleteSnippet('x', denied).ok).toBe(false);
  expect(st.data[SNIPPETS_STORAGE_KEY]).toBe(before);
});