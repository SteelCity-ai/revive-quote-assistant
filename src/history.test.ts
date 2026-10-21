import { describe, expect, it } from 'vitest';
import { defaults, type Line, type Quote } from './domain';
import {
  HISTORY_KEY, MAX_SNAPSHOTS, addSnapshot, captureSnapshot, compareQuotes,
  loadHistory, loadQuoteHistory, restoreSnapshot, saveHistory,
  type HistoryStorage, type QuoteSnapshot,
} from './history';

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

/** Deterministic fake storage; optionally pre-seeded or throwing. */
function fakeStorage(seed: Record<string, string> = {}, fail: 'none' | 'quota' | 'corrupt' = 'none'): HistoryStorage & { data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      if (fail === 'quota') { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
      data.set(k, v);
    },
  };
}

describe('snapshot capture and isolation', () => {
  it('captures a deep copy: later quote edits do not mutate the snapshot', () => {
    const q = makeQuote();
    const snap = captureSnapshot(q, 'before pricing');
    q.lines[0].quantity = 99;
    q.pricing.markup = 999;
    expect(snap.quote.lines[0].quantity).toBe(2);
    expect(snap.quote.pricing.markup).toBe(defaults.markup);
    expect(snap.quoteId).toBe(q.id);
    expect(snap.name).toBe('before pricing');
  });

  it('trims the snapshot name', () => {
    expect(captureSnapshot(makeQuote(), '  patch set  ')).toMatchObject({ name: 'patch set' });
  });

  it('retains only the newest MAX_SNAPSHOTS per quote', () => {
    let history: QuoteSnapshot[] = [];
    for (let i = 0; i < MAX_SNAPSHOTS + 5; i += 1) {
      history = addSnapshot(history, { ...captureSnapshot(makeQuote(), 'v' + i), id: 's-' + i });
    }
    expect(history).toHaveLength(MAX_SNAPSHOTS);
    expect(history[0].name).toBe('v5'); // oldest five dropped
    expect(history[history.length - 1].name).toBe(String('v' + (MAX_SNAPSHOTS + 4)));
  });
});

describe('restore sanitization', () => {
  it('restores as a NEW unapproved quote: fresh id/timestamps, no portal/ai/approval metadata', () => {
    const original = makeQuote({
      approvedAt: '2026-01-02T00:00:00.000Z', acknowledged: true,
      ai: { confidence: 'high', notes: [], warnings: [] } as unknown as Quote['ai'],
      portal: { synced: true } as unknown as Quote['portal'],
    });
    const snap = captureSnapshot(original, 'approved draft');
    const restored = restoreSnapshot(snap);
    expect(restored.id).not.toBe(original.id);
    expect(restored.approvedAt).toBeUndefined();
    expect(restored.acknowledged).toBe(false);
    expect(restored.portal).toBeUndefined();
    expect(restored.ai).toBeUndefined();
    expect(restored.lines).toEqual(original.lines); // original data preserved
    expect(restored.answers).toEqual(original.answers);
    expect(new Date(restored.createdAt).getTime()).toBeGreaterThanOrEqual(new Date(original.createdAt).getTime());
  });

  it('does not mutate the snapshot when restoring twice', () => {
    const snap = captureSnapshot(makeQuote({ acknowledged: true }), 'x');
    const a = restoreSnapshot(snap);
    const b = restoreSnapshot(snap);
    expect(a.id).not.toBe(b.id);
    expect(snap.quote.acknowledged).toBe(true);
  });
});

describe('diffing', () => {
  it('detects added, removed, and changed lines deterministically', () => {
    const from = makeQuote({ lines: [makeLine({ id: 'a', description: 'Tear-off', quantity: 1 }), makeLine({ id: 'b', description: 'Underlayment', quantity: 4 })] });
    const to = makeQuote({ lines: [makeLine({ id: 'a', description: 'Tear-off', quantity: 3 }), makeLine({ id: 'c', description: 'Shingles', quantity: 10 })] });
    const diff = compareQuotes(from, to);
    expect(diff.lineChanges).toEqual([
      { description: 'Tear-off', kind: 'changed', from: { quantity: 1, unit: 'ea', material: 100, hours: 3, rate: 50 }, to: { quantity: 3, unit: 'ea', material: 100, hours: 3, rate: 50 } },
      { description: 'Shingles', kind: 'added', to: { quantity: 10, unit: 'ea', material: 100, hours: 3, rate: 50 } },
      { description: 'Underlayment', kind: 'removed', from: { quantity: 4, unit: 'ea', material: 100, hours: 3, rate: 50 } },
    ]);
    expect(compareQuotes(to, to).lineChanges).toEqual([]);
  });

  it('diffs scope text, pricing fields, and recomputed totals via domain.totals', () => {
    const from = makeQuote({ exclusions: 'none', assumptions: 'a', terms: 't', pricing: { ...defaults, markup: 10 } });
    const to = makeQuote({ exclusions: 'asbestos', assumptions: 'a', terms: 'net 30', pricing: { ...defaults, markup: 20 } });
    const diff = compareQuotes(from, to);
    expect(diff.scopeChanges).toEqual([
      { field: 'exclusions', from: 'none', to: 'asbestos' },
      { field: 'terms', from: 't', to: 'net 30' },
    ]);
    expect(diff.pricingChanges).toEqual([{ field: 'markup', from: 10, to: 20 }]);
    expect(diff.totalChanges.map(c => c.field)).toContain('markup');
    expect(diff.totalChanges.map(c => c.field)).toContain('total');
  });
});

describe('storage', () => {
  it('uses its own versioned key and leaves the legacy revive-quotes-v1 store untouched', () => {
    const legacy = JSON.stringify({ version: 1, quotes: [makeQuote()], pricing: { ...defaults } });
    const storage = fakeStorage({ 'revive-quotes-v1': legacy });
    const q = makeQuote();
    const history = [captureSnapshot(q, 'first')];
    expect(saveHistory(history, storage)).toBe('');
    expect(storage.data.get('revive-quotes-v1')).toBe(legacy);
    expect(JSON.parse(storage.data.get(HISTORY_KEY)!).version).toBe(1);
    expect(loadHistory(storage).snapshots).toEqual(history);
  });

  it('rejects corrupt or unsupported data without erasing it', () => {
    const corrupt = '{"version":1,"snapshots":[{"id":"oops"}';
    const storage = fakeStorage({ [HISTORY_KEY]: corrupt });
    const result = loadHistory(storage);
    expect(result.snapshots).toEqual([]);
    expect(result.error).toContain('preserved');
    expect(storage.data.get(HISTORY_KEY)).toBe(corrupt);
  });

  it('rejects unsupported version payloads without erasing them', () => {
    const bad = JSON.stringify({ version: 99, snapshots: [] });
    const storage = fakeStorage({ [HISTORY_KEY]: bad });
    expect(loadHistory(storage).error).toContain('preserved');
    expect(storage.data.get(HISTORY_KEY)).toBe(bad);
  });

  it('reports quota errors on save and does not overwrite existing data', () => {
    const existing = JSON.stringify({ version: 1, snapshots: [] });
    const storage = fakeStorage({ [HISTORY_KEY]: existing }, 'quota');
    const error = saveHistory([captureSnapshot(makeQuote())], storage);
    expect(error).toContain('full');
    expect(storage.data.get(HISTORY_KEY)).toBe(existing);
  });

  it('refuses to save snapshots that fail shape validation', () => {
    const storage = fakeStorage();
    const bad = { id: '', quoteId: 'q', name: '', createdAt: 'nope', quote: {} } as unknown as QuoteSnapshot;
    expect(saveHistory([bad], storage)).not.toBe('');
    expect(storage.getItem(HISTORY_KEY)).toBeNull();
  });

  it('filters per-quote history with the retention cap', () => {
    const q1 = makeQuote();
    const q2 = makeQuote();
    let all: QuoteSnapshot[] = [];
    for (let i = 0; i < MAX_SNAPSHOTS + 3; i += 1) all = addSnapshot(all, { ...captureSnapshot(q1, 'v' + i), id: 's' + i });
    all.push(captureSnapshot(q2, 'other'));
    const storage = fakeStorage({ [HISTORY_KEY]: JSON.stringify({ version: 1, snapshots: all }) });
    const mine = loadQuoteHistory(q1.id, storage);
    expect(mine.error).toBe('');
    expect(mine.snapshots).toHaveLength(MAX_SNAPSHOTS);
    expect(mine.snapshots.every(s => s.quoteId === q1.id)).toBe(true);
    expect(mine.snapshots[0].name).toBe('v3');
  });
});
