import { describe, expect, it } from 'vitest';
import { defaults, type Line, type Quote } from './domain';
import { discountedTotals } from './margin';
import {
  HISTORY_KEY, MAX_SNAPSHOTS, addSnapshot, captureSnapshot, compareQuotes,
  loadHistory, loadQuoteHistory, mergeQuoteHistory, restoreSnapshot,
  type HistoryStorage, type QuoteSnapshot,
} from './history';

// Regression coverage for the Q1 history audit defects (STE-73):
// duplicate descriptions, renames, discounted totals, answers/type/kind/tier,
// malformed snapshot preservation, cross-quote save retention, and restore safety.

function makeLine(overrides: Partial<Line> = {}): Line {
  return { id: 'l-' + Math.random().toString(36).slice(2), description: 'Demo work', quantity: 2, unit: 'ea', material: 100, hours: 3, rate: 50, ...overrides };
}

let seq = 0;
function makeQuote(overrides: Partial<Quote> = {}): Quote {
  seq += 1;
  return {
    id: 'q-' + seq, type: 'roofing', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    step: 2, stage: 'review', answers: { customer: 'Pat' }, lines: [makeLine()], pricing: { ...defaults },
    exclusions: '', assumptions: '', terms: '', kind: 'estimate', acknowledged: false, ...overrides,
  };
}

/** Map-backed storage so raw persisted bytes can be asserted after refusals. */
function mapStorage(seed: Record<string, string> = {}): HistoryStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => { data.set(k, v); },
  };
}

/** Quote with two lines that share the same description but have distinct stable ids. */
function duplicateDescriptionQuote(): Quote {
  const q = makeQuote({ answers: { customer: 'Pat', workArea: '100' }, discountPercent: 0 });
  q.lines = [
    makeLine({ id: 'a', description: 'Trim', quantity: 1, material: 100 }),
    makeLine({ id: 'b', description: 'Trim', quantity: 2, material: 10 }),
  ];
  return q;
}

describe('audit regressions: line matching', () => {
  it('detects a quantity change on the FIRST of two same-description lines by stable id', () => {
    const from = duplicateDescriptionQuote();
    const to = structuredClone(from);
    to.lines[0].quantity = 5; // only line 'a' changes; line 'b' with identical description stays 2
    const diff = compareQuotes(from, to);
    expect(diff.lineChanges).toHaveLength(1);
    expect(diff.lineChanges[0]).toMatchObject({ description: 'Trim', kind: 'changed', from: { quantity: 1 }, to: { quantity: 5 } });
    expect(diff.lineChanges[0].to?.material).toBe(100); // matched line 'a', not 'b'
  });

  it('reports an id-stable rename as a changed line, preserving duplicate descriptions', () => {
    const from = duplicateDescriptionQuote();
    const to = structuredClone(from);
    to.lines[0].description = 'Trim renamed';
    const diff = compareQuotes(from, to);
    expect(diff.lineChanges).toHaveLength(1);
    expect(diff.lineChanges[0].kind).toBe('changed');
    expect(diff.lineChanges[0].description).toBe('Trim renamed');
    expect(diff.lineChanges[0].fromDescription).toBe('Trim');
    // the untouched duplicate keeps its own entry untouched
    expect(compareQuotes(from, structuredClone(to)).lineChanges.every(c => c.kind === 'changed')).toBe(true);
  });
});

describe('audit regressions: totals and scope', () => {
  it('surfaces a discount change as real discounted customer-total movement', () => {
    const from = duplicateDescriptionQuote();
    const to = { ...structuredClone(from), discountPercent: 10 };
    const expected = discountedTotals(to.lines, to.pricing, 10).total;
    const diff = compareQuotes(from, to);
    expect(diff.pricingChanges).toEqual([{ field: 'discountPercent', from: 0, to: 10 }]);
    expect(diff.totalChanges.some(c => c.field === 'total' && c.to === expected)).toBe(true);
    const fromTotal = discountedTotals(from.lines, from.pricing, 0).total;
    expect(diff.totalChanges.find(c => c.field === 'total')).toMatchObject({ from: fromTotal });
  });

  it('includes answer, type, kind, stage and tier changes in the diff', () => {
    const from = duplicateDescriptionQuote();
    const to = structuredClone(from);
    to.answers = { ...to.answers, workArea: '200', access: 'ladder' };
    to.type = 'renovation';
    to.kind = 'fixed';
    to.stage = 'guide';
    to.tier = 'premium';
    const diff = compareQuotes(from, to);
    expect(diff.answerChanges).toEqual([
      { field: 'access', from: '', to: 'ladder' },
      { field: 'workArea', from: '100', to: '200' },
    ]);
    expect(diff.quoteChanges).toEqual([
      { field: 'type', from: 'roofing', to: 'renovation' },
      { field: 'kind', from: 'estimate', to: 'fixed' },
      { field: 'stage', from: 'review', to: 'guide' },
    ]);
    expect(diff.pricingChanges).toEqual([{ field: 'tier', from: '', to: 'premium' }]);
  });

  it('reports an answers-only change as a non-empty diff (no more empty comparisons)', () => {
    const from = duplicateDescriptionQuote();
    const to = structuredClone(from);
    to.answers.workArea = '200';
    const diff = compareQuotes(from, to);
    expect(diff).toMatchObject({ lineChanges: [], answerChanges: [{ field: 'workArea', from: '100', to: '200' }] });
    expect(Object.values(diff).some(changes => changes.length > 0)).toBe(true);
  });
});

describe('audit regressions: snapshot persistence safety', () => {
  it('validates complete snapshot shapes and preserves unreadable persisted data untouched', () => {
    const q = makeQuote();
    const malformed = JSON.stringify({
      version: 1,
      snapshots: [{ id: 'bad', quoteId: q.id, name: 'Bad', createdAt: q.createdAt, quote: { id: q.id, lines: [], pricing: q.pricing } }],
    });
    const storage = mapStorage({ [HISTORY_KEY]: malformed });
    let writes = 0;
    const guarded: HistoryStorage = { ...storage, setItem: (k, v) => { writes += 1; storage.setItem(k, v); } };
    const result = loadHistory(guarded);
    expect(result.error).toContain('preserved');
    expect(result.snapshots).toEqual([]);
    expect(writes).toBe(0);
    // merge must refuse rather than overwrite the malformed payload
    expect(mergeQuoteHistory(q.id, [], guarded)).not.toBe('');
    expect(writes).toBe(0);
    expect(storage.data.get(HISTORY_KEY)).toBe(malformed);
  });

  it('keeps per-quote histories independent across interleaved saves (A,B,A,B)', () => {
    const storage = mapStorage();
    const a = duplicateDescriptionQuote();
    const b = makeQuote();
    for (const [quote, label] of [[a, 'A1'], [b, 'B1'], [a, 'A2'], [b, 'B2']] as const) {
      const updated = addSnapshot(loadQuoteHistory(quote.id, storage).snapshots, captureSnapshot(quote, label));
      expect(mergeQuoteHistory(quote.id, updated, storage)).toBe('');
    }
    expect(loadQuoteHistory(a.id, storage).snapshots.map(s => s.name)).toEqual(['A1', 'A2']);
    expect(loadQuoteHistory(b.id, storage).snapshots.map(s => s.name)).toEqual(['B1', 'B2']);
    expect(loadQuoteHistory(a.id, storage).snapshots.every(s => s.quoteId === a.id)).toBe(true);
  });

  it('enforces the per-quote cap while other quotes stay intact', () => {
    const storage = mapStorage();
    const a = makeQuote();
    const b = makeQuote();
    let history: QuoteSnapshot[] = [];
    for (let i = 0; i < MAX_SNAPSHOTS + 3; i += 1) {
      history = addSnapshot(history, { ...captureSnapshot(a, 'a' + i), id: 'sa' + i });
    }
    expect(mergeQuoteHistory(a.id, history, storage)).toBe('');
    // b's own save merges alongside a's persisted snapshots without erasing them.
    const bList = addSnapshot([], { ...captureSnapshot(b, 'b-only'), id: 'sb' });
    expect(mergeQuoteHistory(b.id, bList, storage)).toBe('');
    const aLoad = loadQuoteHistory(a.id, storage);
    // a's capped list is untouched by b's save: newest MAX_SNAPSHOTS of a's 23.
    expect(aLoad.snapshots).toHaveLength(MAX_SNAPSHOTS);
    expect(aLoad.snapshots[0].name).toBe('a3');
    expect(aLoad.snapshots[aLoad.snapshots.length - 1].name).toBe('a22');
    expect(aLoad.snapshots.every(s => s.quoteId === a.id)).toBe(true);
    expect(loadQuoteHistory(b.id, storage).snapshots.map(s => s.name)).toEqual(['b-only']);
  });

  it('restores as a fresh unapproved quote and never mutates the stored snapshot', () => {
    const original = makeQuote({
      approvedAt: '2026-01-02T00:00:00.000Z',
      acknowledged: true,
      ai: { fingerprint: 'synthetic' } as unknown as Quote['ai'],
      portal: { quoteId: 'synthetic-receipt' } as unknown as Quote['portal'],
    });
    const before = JSON.stringify(original);
    const snap = captureSnapshot(original, 'approved prior');
    const restored = restoreSnapshot(snap);
    expect(restored.id).not.toBe(original.id);
    expect(restored.approvedAt).toBeUndefined();
    expect(restored.acknowledged).toBe(false);
    expect(restored.portal).toBeUndefined();
    expect(restored.ai).toBeUndefined();
    expect(JSON.parse(before)).toEqual(original); // raw snapshot quote untouched
  });
});
