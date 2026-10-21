import { afterEach, describe, expect, it } from 'vitest';
import type { Quote } from './domain';
import { commitDraftImport, parseDraftImport } from './import';

function validQuote(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    id: 'q-1',
    type: 'renovation',
    kind: 'estimate',
    stage: 'review',
    step: 4,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    answers: { customer: 'ACME', trades: ['Painting & finishes'] },
    lines: [{ id: 'l-1', description: 'Paint', quantity: 2, unit: 'rooms', material: 100, hours: 8, rate: 50 }],
    pricing: { laborRate: 50, markup: 15, contingency: 0, tax: 6 },
    exclusions: 'no HVAC',
    assumptions: '',
    terms: 'net 30',
    approvedAt: '2026-01-03T00:00:00.000Z',
    acknowledged: true,
    ...overrides,
  };
}

function reviewExport(overrides: Partial<Record<string, unknown>> = {}): string {
  return JSON.stringify({ version: 1, quote: validQuote(overrides), calculatedTotals: { total: 999999 } });
}

function backupExport(quotes: unknown[] = [validQuote()], pricing = { laborRate: 99, markup: 25, contingency: 5, tax: 7 }): string {
  return JSON.stringify({ version: 1, quotes, pricing });
}

function existingQuotes(): Quote[] {
  return parseDraftImport(backupExport(), []).quotes;
}

describe('parseDraftImport — real export formats', () => {
  it('parses the Review.tsx exportQuote format and ignores calculatedTotals', () => {
    const preview = parseDraftImport(reviewExport(), []);
    expect(preview.format).toBe('quote-export-v1');
    expect(preview.quotes).toHaveLength(1);
    expect(preview.quotes[0].answers.customer).toBe('ACME');
    expect(preview.warnings.some(w => w.includes('calculatedTotals'))).toBe(true);
  });

  it('parses the Settings backup format', () => {
    const preview = parseDraftImport(backupExport(), []);
    expect(preview.format).toBe('settings-backup-v1');
    expect(preview.quotes).toHaveLength(1);
    expect(preview.warnings.some(w => w.includes('pricing'))).toBe(true);
  });

  it('roundtrips tier, discountPercent, answers and lines', () => {
    const text = reviewExport({ tier: 'premium', discountPercent: 10, answers: { customer: 'B', note: ['a', 'b'] } });
    const preview = parseDraftImport(text, []);
    expect(preview.quotes[0].tier).toBe('premium');
    expect(preview.quotes[0].discountPercent).toBe(10);
    expect(preview.quotes[0].answers.note).toEqual(['a', 'b']);
    expect(preview.quotes[0].lines[0].description).toBe('Paint');
  });

  it('strips approvedAt, acknowledged, portal, ai and unknown fields', () => {
    const text = reviewExport({ portal: { something: 1 }, ai: { report: true }, mysteryField: 'x' });
    const preview = parseDraftImport(text, []);
    const q = preview.quotes[0] as Record<string, unknown>;
    expect(q.approvedAt).toBeUndefined();
    expect(q.acknowledged).toBe(false);
    expect(q.portal).toBeUndefined();
    expect(q.ai).toBeUndefined();
    expect(q.mysteryField).toBeUndefined();
  });
});

describe('parseDraftImport — malformed and hostile input', () => {
  it('rejects invalid JSON, arrays, null, and wrong version', () => {
    expect(() => parseDraftImport('not json', [])).toThrow(/JSON/);
    expect(() => parseDraftImport('[]', [])).toThrow(/object/);
    expect(() => parseDraftImport('null', [])).toThrow(/object/);
    expect(() => parseDraftImport(JSON.stringify({ version: 2, quotes: [] }), [])).toThrow(/version/i);
    expect(() => parseDraftImport('', [])).toThrow(/empty/i);
  });

  it('rejects nonfinite and negative money, quantities, discount', () => {
    expect(() => parseDraftImport(reviewExport({ lines: [{ id: 'l', description: 'x', quantity: -1, unit: 'u', material: 0, hours: 0, rate: 0 }] }), [])).toThrow(/quantity/);
    expect(() => parseDraftImport(reviewExport({ pricing: { laborRate: NaN, markup: 15, contingency: 0, tax: 0 } }), [])).toThrow(/pricing/);
    expect(() => parseDraftImport(reviewExport({ discountPercent: 150 }), [])).toThrow(/discount/);
    expect(() => parseDraftImport(reviewExport({ lines: [{ id: 'l', description: 'x', quantity: Infinity, unit: 'u', material: 0, hours: 0, rate: 0 }] }), [])).toThrow(/quantity/);
    expect(() => parseDraftImport(reviewExport({ lines: [{ id: 'l', description: 'x', quantity: 1, unit: 'u', material: 1e13, hours: 0, rate: 0 }] }), [])).toThrow(/money|overflow/i);
  });

  it('rejects invalid enums and structure', () => {
    expect(() => parseDraftImport(reviewExport({ type: 'demolition' }), [])).toThrow(/not a supported value/i);
    expect(() => parseDraftImport(reviewExport({ kind: 'proposal' }), [])).toThrow(/kind/);
    expect(() => parseDraftImport(reviewExport({ answers: { a: 5 } }), [])).toThrow(/answer/);
    expect(() => parseDraftImport(reviewExport({ lines: 'nope' }), [])).toThrow(/lines/);
    expect(() => parseDraftImport(JSON.stringify({ version: 1, quote: validQuote(), quotes: [validQuote()] }), [])).toThrow(/Ambiguous/);
    expect(() => parseDraftImport(JSON.stringify({ version: 1 }), [])).toThrow(/neither a quote export nor a settings backup/i);
  });

  it('enforces payload, quote count, and line-count bounds', () => {
    const big = 'x'.repeat(2 * 1024 * 1024 + 1);
    expect(() => parseDraftImport(reviewExport({ answers: { customer: big } }), [])).toThrow(/2 MiB|payload|length/i);
    const many = Array.from({ length: 101 }, (_, i) => validQuote({ id: `q-${i}` }));
    expect(() => parseDraftImport(backupExport(many), [])).toThrow(/100 quotes/);
    const longLines = Array.from({ length: 501 }, (_, i) => ({ id: `l${i}`, description: 'x', quantity: 1, unit: 'u', material: 0, hours: 0, rate: 0 }));
    expect(() => parseDraftImport(reviewExport({ lines: longLines }), [])).toThrow(/500 lines/);
  });
});

describe('duplicate detection', () => {
  it('flags duplicates against existing by id and content', () => {
    const existing = existingQuotes();
    expect(parseDraftImport(reviewExport(), existing).duplicates).toEqual([0]); // same id
    const sameContent = JSON.parse(backupExport()) as { quotes: Record<string, unknown>[] };
    sameContent.quotes[0].id = 'brand-new-id';
    expect(parseDraftImport(JSON.stringify({ version: 1, quotes: sameContent.quotes, pricing: { laborRate: 1, markup: 2, contingency: 3, tax: 4 } }), existing).duplicates).toEqual([0]);
  });

  it('flags duplicates within the payload itself', () => {
    const text = backupExport([validQuote(), validQuote({ id: 'q-2' })]);
    expect(parseDraftImport(text, []).duplicates).toEqual([1]);
  });

  it('ignores id, timestamps and approval metadata in content comparison', () => {
    const existing = existingQuotes();
    const changed = JSON.parse(reviewExport()) as Record<string, unknown>;
    const q = changed.quote as Record<string, unknown>;
    q.id = 'other-id'; q.createdAt = '2020-01-01'; q.updatedAt = '2020-01-01'; q.approvedAt = '2020-01-01';
    expect(parseDraftImport(JSON.stringify(changed), existing).duplicates).toEqual([0]);
    const different = JSON.parse(reviewExport({ id: 'different-quote', answers: { customer: 'Different' } }));
    expect(parseDraftImport(JSON.stringify(different), existing).duplicates).toEqual([]);
  });
});

describe('commitDraftImport', () => {
  const store = new Map<string, string>();
  const fakeStorage: Pick<Storage, 'setItem'> = {
    setItem: (k: string, v: string) => { store.set(k, v); },
  };

  afterEach(() => store.clear());

  it('throws on duplicates unless allowDuplicates, before any write', () => {
    const preview = parseDraftImport(reviewExport(), existingQuotes());
    expect(() => commitDraftImport(preview, { version: 1, quotes: existingQuotes(), pricing: { laborRate: 1, markup: 1, contingency: 1, tax: 1 } }, { allowDuplicates: false }, fakeStorage)).toThrow(/duplicate/i);
    expect(store.size).toBe(0);
  });

  it('creates fresh ids, review stage, unapproved, and writes storage once', () => {
    const existing = existingQuotes();
    const preview = parseDraftImport(reviewExport(), existing);
    const current = { version: 1 as const, quotes: existing, pricing: { laborRate: 42, markup: 10, contingency: 2, tax: 5 } };
    const next = commitDraftImport(preview, current, { allowDuplicates: true }, fakeStorage);
    expect(next.quotes).toHaveLength(existing.length + 1);
    const added = next.quotes[next.quotes.length - 1];
    expect(added.id).not.toBe(existing[0].id);
    expect(added.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(added.lines[0].id).not.toBe(existing[0].lines[0].id);
    expect(added.stage).toBe('review');
    expect(added.step).toBe(0);
    expect(added.acknowledged).toBe(false);
    expect((added as Partial<Quote>).approvedAt).toBeUndefined();
    expect(next.pricing).toEqual(current.pricing); // global pricing preserved
    expect(store.get('revive-quotes-v1')).toBeDefined();
    const written = JSON.parse(store.get('revive-quotes-v1')!) as { quotes: Quote[] };
    expect(written.quotes).toHaveLength(existing.length + 1);
  });

  it('preserves existing quotes untouched', () => {
    const existing = existingQuotes();
    const preview = parseDraftImport(backupExport([validQuote({ id: 'fresh-9' })]), []);
    const next = commitDraftImport(preview, { version: 1, quotes: existing, pricing: { laborRate: 1, markup: 1, contingency: 1, tax: 1 } }, { allowDuplicates: true }, fakeStorage);
    expect(next.quotes[0]).toEqual(existing[0]);
    expect(next.quotes[1].id).not.toBe('fresh-9'); // fresh UUID, imported id discarded
  });

  it('leaves storage unchanged when setItem fails (atomicity)', () => {
    const failing: Pick<Storage, 'setItem'> = { setItem: () => { throw new Error('quota'); } };
    const preview = parseDraftImport(backupExport(), []);
    const current = { version: 1 as const, quotes: [], pricing: { laborRate: 1, markup: 1, contingency: 1, tax: 1 } };
    expect(() => commitDraftImport(preview, current, { allowDuplicates: false }, failing)).toThrow(/quota|unchanged/i);
  });

  it('writes with default localStorage when no store is passed', () => {
    const original = globalThis.localStorage;
    const map = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', { value: { setItem: (k: string, v: string) => map.set(k, v) }, configurable: true, writable: true });
    try {
      const preview = parseDraftImport(backupExport(), []);
      commitDraftImport(preview, { version: 1, quotes: [], pricing: { laborRate: 1, markup: 1, contingency: 1, tax: 1 } }, { allowDuplicates: false });
      expect(map.get('revive-quotes-v1')).toBeDefined();
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true, writable: true });
    }
  });
});
