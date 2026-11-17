import { describe, expect, it, vi } from 'vitest';
import { defaults, type Quote } from './domain';
import {
  HISTORY_KEY, captureSnapshot, deleteQuoteHistory, loadHistory, loadQuoteHistory,
  pruneOrphanHistory, saveHistory, type HistoryStorage, type QuoteSnapshot,
} from './history';

let seq = 0;
function makeQuote(overrides: Partial<Quote> = {}): Quote {
  seq += 1;
  return {
    id: 'dq-' + seq, type: 'roofing', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    step: 2, stage: 'review', answers: { customer: 'Pat' },
    lines: [{ id: 'dl-' + seq, description: 'Demo work', quantity: 2, unit: 'ea', material: 100, hours: 3, rate: 50 }],
    pricing: { ...defaults }, exclusions: '', assumptions: '', terms: '', kind: 'estimate', acknowledged: false,
    ...overrides,
  };
}

/** Deterministic fake storage; optionally seeded, quota-failing or corrupt. */
function fakeStorage(seed: Record<string, string> = {}, fail: 'none' | 'quota' | 'corrupt' = 'none') {
  const data = new Map(Object.entries(seed));
  const setItem = vi.fn((k: string, v: string) => {
    if (fail === 'quota') { const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
    data.set(k, v);
  });
  const storage: HistoryStorage & { data: Map<string, string>; setItem: typeof setItem } = {
    data, setItem, getItem: (k: string) => data.get(k) ?? null,
  };
  return storage;
}

function seeded(snapshots: QuoteSnapshot[], fail: 'none' | 'quota' | 'corrupt' = 'none') {
  return fakeStorage({ [HISTORY_KEY]: JSON.stringify({ version: 1, snapshots }) }, fail);
}

describe('deleteQuoteHistory', () => {
  it('removes only the deleted quote history and keeps every other quote', () => {
    const keep = makeQuote();
    const drop = makeQuote();
    const storage = seeded([
      captureSnapshot(keep, 'keep 1'), captureSnapshot(drop, 'drop 1'), captureSnapshot(keep, 'keep 2'),
    ]);

    expect(deleteQuoteHistory(drop.id, storage)).toBe('');
    const left = loadHistory(storage).snapshots;
    expect(left.map(s => s.name)).toEqual(['keep 1', 'keep 2']);
    expect(left.every(s => s.quoteId === keep.id)).toBe(true);
    expect(loadQuoteHistory(drop.id, storage).snapshots).toEqual([]);
  });

  it('is a no-op that does not rewrite storage when the quote has no history', () => {
    const a = makeQuote();
    const storage = seeded([captureSnapshot(a)]);
    const before = storage.data.get(HISTORY_KEY);

    expect(deleteQuoteHistory('missing-quote', storage)).toBe('');
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.data.get(HISTORY_KEY)).toBe(before);
  });

  it('leaves existing history untouched when a delete would fail on full storage', () => {
    const keep = makeQuote();
    const drop = makeQuote();
    const storage = seeded([captureSnapshot(keep), captureSnapshot(drop)], 'quota');
    const before = storage.data.get(HISTORY_KEY);

    expect(deleteQuoteHistory(drop.id, storage)).toContain('Storage is full');
    expect(storage.data.get(HISTORY_KEY)).toBe(before);
    expect(loadHistory(storage).snapshots).toHaveLength(2);
  });

  it('refuses to overwrite unreadable persisted history', () => {
    const storage = fakeStorage({ [HISTORY_KEY]: '{"version":9,"snapshots":"nope"}' });

    expect(deleteQuoteHistory('anything', storage)).not.toBe('');
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(storage.data.get(HISTORY_KEY)).toBe('{"version":9,"snapshots":"nope"}');
  });

  it('deleting the source quote also clears checkpoints even if a restored copy exists', () => {
    const source = makeQuote();
    const restored = makeQuote({ id: 'restored-copy' });
    const storage = seeded([captureSnapshot(source, 'before restore'), captureSnapshot(restored, 'restored work')]);

    expect(deleteQuoteHistory(source.id, storage)).toBe('');
    expect(loadQuoteHistory(source.id, storage).snapshots).toEqual([]);
    expect(loadQuoteHistory(restored.id, storage).snapshots.map(s => s.name)).toEqual(['restored work']);
  });
});

describe('pruneOrphanHistory', () => {
  it('drops history whose quote is no longer stored and keeps live quotes', () => {
    const live = makeQuote();
    const gone = makeQuote();
    const storage = seeded([captureSnapshot(gone, 'orphan 1'), captureSnapshot(live, 'live 1'), captureSnapshot(gone, 'orphan 2')]);

    expect(pruneOrphanHistory([live.id], storage)).toEqual({ removed: 2, error: '' });
    expect(loadHistory(storage).snapshots.map(s => s.name)).toEqual(['live 1']);
  });

  it('does not rewrite storage when nothing is orphaned', () => {
    const a = makeQuote();
    const b = makeQuote();
    const storage = seeded([captureSnapshot(a), captureSnapshot(b)]);

    expect(pruneOrphanHistory([a.id, b.id], storage)).toEqual({ removed: 0, error: '' });
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('removes all history when no quotes remain on the device', () => {
    const a = makeQuote();
    const storage = seeded([captureSnapshot(a)]);

    expect(pruneOrphanHistory([], storage)).toEqual({ removed: 1, error: '' });
    expect(loadHistory(storage).snapshots).toEqual([]);
  });

  it('reports a full-storage failure without destroying the orphan data', () => {
    const gone = makeQuote();
    const storage = seeded([captureSnapshot(gone)], 'quota');

    const result = pruneOrphanHistory([], storage);
    expect(result.removed).toBe(0);
    expect(result.error).toContain('Storage is full');
    expect(loadHistory(storage).snapshots).toHaveLength(1);
  });

  it('returns an error and writes nothing when stored history cannot be read', () => {
    const storage = fakeStorage({ [HISTORY_KEY]: 'not json' });

    const result = pruneOrphanHistory([], storage);
    expect(result.removed).toBe(0);
    expect(result.error).not.toBe('');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('keeps a healthy save working after a prune (round trip)', () => {
    const live = makeQuote();
    const gone = makeQuote();
    const storage = seeded([captureSnapshot(gone), captureSnapshot(live, 'kept')]);

    expect(pruneOrphanHistory([live.id], storage).error).toBe('');
    expect(saveHistory([...loadHistory(storage).snapshots, captureSnapshot(live, 'new')], storage)).toBe('');
    expect(loadHistory(storage).snapshots.map(s => s.name)).toEqual(['kept', 'new']);
  });
});
