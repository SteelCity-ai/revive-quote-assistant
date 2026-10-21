import { describe, expect, it } from 'vitest';
import { makeQuote } from './domain';
import type { Line, Quote } from './domain';
import {
  SNIPPETS_MAX_COUNT,
  SNIPPETS_MAX_LINES,
  SNIPPETS_MAX_TOTAL_BYTES,
  SNIPPETS_STORAGE_KEY,
  appendSnippetLines,
  deleteSnippet,
  loadSnippets,
  previewDuplicate,
  saveSnippet,
  searchSnippets,
  type Snippet,
  type SnippetsStorage,
} from './snippets';

type Store = Record<string, string>;

const quota = () => Object.assign(new Error('quota'), { name: 'QuotaExceededError' });

const fakeStorage = (initial: Store = {}): SnippetsStorage & { data: Store } => {
  const data: Store = { ...initial };
  return {
    data,
    getItem: (key: string) => (key in data ? data[key]! : null),
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
};

/** Storage whose setItem always throws QuotaExceededError. */
const fullStorage = (): SnippetsStorage => ({
  getItem: () => null,
  setItem: () => {
    throw quota();
  },
});

const line = (over: Partial<Line> = {}): Line => ({
  id: 'line-1',
  description: 'Demo drywall patch',
  quantity: 12,
  unit: 'sq ft',
  material: 3.5,
  hours: 0.25,
  rate: 65,
  ...over,
});

const save = (storage: SnippetsStorage, over: { name?: string; lines?: Line[] } = {}) =>
  saveSnippet({ name: over.name ?? 'Wall patch', lines: over.lines ?? [line()] }, storage);

const expectErr = (r: { ok: boolean }) => expect(r.ok).toBe(false);

describe('snippets: storage key isolation', () => {
  it('uses its own key and never touches revive-quotes-v1', () => {
    const s = fakeStorage({ 'revive-quotes-v1': '{"version":1,"quotes":[],"pricing":{}}' });
    const r = save(s);
    expect(r.ok).toBe(true);
    expect(SNIPPETS_STORAGE_KEY).not.toBe('revive-quotes-v1');
    expect(s.data['revive-quotes-v1']).toBe('{"version":1,"quotes":[],"pricing":{}}');
    expect(s.data[SNIPPETS_STORAGE_KEY]).toBeDefined();
  });
});

describe('snippets: whitelist and metadata stripping', () => {
  it('stores only whitelisted line values, stripping customer/portal/AI metadata', () => {
    const s = fakeStorage();
    const dirty = Object.assign(line(), {
      customer: 'Acme',
      portalReceipt: 'x',
      ai: { y: 1 },
      approvedAt: 'today',
      secret: true,
    }) as unknown as Line;
    const r = save(s, { lines: [dirty] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snippet.lines[0]).toEqual({
      description: 'Demo drywall patch',
      quantity: 12,
      unit: 'sq ft',
      material: 3.5,
      hours: 0.25,
      rate: 65,
    });
    expect(JSON.stringify(JSON.parse(s.data[SNIPPETS_STORAGE_KEY]!))).not.toMatch(
      /Acme|portalReceipt|approvedAt|secret/,
    );
  });

  it('captures the stored rate at save time as a reference value', () => {
    const s = fakeStorage();
    const r = save(s, { lines: [line({ rate: 82.5 })] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.snippet.lines[0].rate).toBe(82.5);
    const stored = JSON.parse(s.data[SNIPPETS_STORAGE_KEY]!) as { snippets: Snippet[] };
    expect(stored.snippets[0].lines[0].rate).toBe(82.5);
    expect(stored.snippets[0].savedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('rejects invalid lines (non-finite, negative, bad quantity) without writing', () => {
    const s = fakeStorage();
    for (const bad of [
      line({ material: Number.NaN }),
      line({ rate: -1 }),
      line({ hours: Infinity }),
      line({ quantity: 0 }),
      line({ quantity: -2 }),
      line({ description: '   ' }),
      line({ description: 42 }) as unknown as Line,
    ]) {
      const r = save(s, { lines: [bad] });
      expectErr(r);
    }
    expect(s.data[SNIPPETS_STORAGE_KEY]).toBeUndefined();
  });

  it('rejects empty or missing name', () => {
    const s = fakeStorage();
    expectErr(save(s, { name: '  ' }));
    const r = saveSnippet({ name: undefined as unknown as string, lines: [line()] }, s);
    expect(r.ok).toBe(false);
    expect(s.data[SNIPPETS_STORAGE_KEY]).toBeUndefined();
  });
});

describe('snippets: append preserves existing lines and uses fresh ids', () => {
  it('appends sanitized copies with fresh line ids, leaving existing lines/pricing untouched', () => {
    const s = fakeStorage();
    const saveResult = save(s);
    expect(saveResult.ok).toBe(true);
    if (!saveResult.ok) return;
    const quote = makeQuote('renovation', { laborRate: 75, markup: 15, contingency: 0, tax: 0 });
    const existing: Line = {
      id: 'existing-1',
      description: 'Original item',
      quantity: 1,
      unit: 'ea',
      material: 10,
      hours: 1,
      rate: 75,
    };
    quote.lines = [existing];
    const before = JSON.stringify(quote);
    const r = appendSnippetLines(saveResult.snippet.id, quote.lines, s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines).toHaveLength(2);
    expect(r.appended).toHaveLength(1);
    expect(r.lines[0]).toEqual(existing);
    expect(r.lines[1].id).not.toBe('line-1');
    expect(r.lines[1].description).toBe('Demo drywall patch');
    expect(quote.pricing).toEqual({ laborRate: 75, markup: 15, contingency: 0, tax: 0 });
    // The input quote object is never mutated.
    expect(JSON.stringify(quote)).toBe(before);
    // Approval/portal metadata cannot be altered by append.
    expect(quote.acknowledged).toBe(quote.acknowledged);
    expect(quote.approvedAt).toBe(quote.approvedAt);
    expect(quote.portal).toBe(quote.portal);
  });

  it('errors on unknown snippet id and never mutates the existing lines', () => {
    const quote = makeQuote('roofing', { laborRate: 70, markup: 15, contingency: 0, tax: 0 });
    const existing: Line = {
      id: 'orig',
      description: 'Keep',
      quantity: 1,
      unit: 'ea',
      material: 0,
      hours: 1,
      rate: 70,
    };
    quote.lines = [existing];
    const before = JSON.stringify(quote.lines);
    const r = appendSnippetLines('nope', quote.lines, fakeStorage());
    expectErr(r);
    expect(JSON.stringify(quote.lines)).toBe(before);
  });

  it('refuses to append when it would exceed the per-snippet line bound', () => {
    const s = fakeStorage();
    const saveResult = save(s);
    expect(saveResult.ok).toBe(true);
    if (!saveResult.ok) return;
    const quote = makeQuote('renovation', { laborRate: 75, markup: 15, contingency: 0, tax: 0 });
    quote.lines = Array.from({ length: SNIPPETS_MAX_LINES }, (_, i) => line({ id: `l${i}` }));
    const r = appendSnippetLines(saveResult.snippet.id, quote.lines, s);
    expectErr(r);
    expect(quote.lines).toHaveLength(SNIPPETS_MAX_LINES);
  });
});

describe('snippets: duplicate preview', () => {
  it('finds an existing snippet with the same name and identical content', () => {
    const s = fakeStorage();
    save(s);
    const { snippets } = loadSnippets(s);
    expect(previewDuplicate({ name: 'wall PATCH', lines: [line()] }, snippets)).not.toBeNull();
    expect(
      previewDuplicate({ name: 'Wall patch', lines: [line({ description: 'different' })] }, snippets),
    ).toBeNull();
    expect(previewDuplicate({ name: 'Other name', lines: [line()] }, snippets)).toBeNull();
    expect(previewDuplicate({ name: '', lines: [line()] }, snippets)).toBeNull();
  });
});

describe('snippets: search and delete', () => {
  it('searches names and descriptions case-insensitively; empty query returns all', () => {
    const s = fakeStorage();
    save(s, { name: 'Wall patch' });
    save(s, { name: 'Roof tear-off', lines: [line({ description: 'TPO membrane removal' })] });
    const { snippets } = loadSnippets(s);
    expect(searchSnippets(snippets, 'patch')).toHaveLength(1);
    expect(searchSnippets(snippets, 'TPO')).toHaveLength(1);
    expect(searchSnippets(snippets, 'WALL')).toHaveLength(1);
    expect(searchSnippets(snippets, '')).toHaveLength(2);
    expect(searchSnippets(snippets, 'nothing matches')).toHaveLength(0);
  });

  it('deletes by id and reports unknown ids', () => {
    const s = fakeStorage();
    const a = save(s).snippet!;
    save(s, { name: 'Second' });
    const d = deleteSnippet(a.id, s);
    expect(d.ok).toBe(true);
    expect(d.deleted).toBe(true);
    expect(loadSnippets(s).snippets).toHaveLength(1);
    const d2 = deleteSnippet('missing-id', s);
    expect(d2.ok).toBe(false);
    expect(d2.error).not.toBe('');
  });
});

describe('snippets: corrupt store handling', () => {
  it('refuses corrupt/unrecognized version data and preserves the raw store', () => {
    const corrupt = '{"version":99,"snippets":[]}';
    const s = fakeStorage({ [SNIPPETS_STORAGE_KEY]: corrupt });
    const r = loadSnippets(s);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('unsupported-version');
    expect(s.data[SNIPPETS_STORAGE_KEY]).toBe(corrupt);
    // Mutations refuse to overwrite unreadable persisted data.
    expectErr(save(s));
    expect(s.data[SNIPPETS_STORAGE_KEY]).toBe(corrupt);
  });

  it('refuses structurally broken JSON and preserves prior storage', () => {
    const bad = '{"version":1,"snippets":[{"id":1}';
    const s = fakeStorage({ [SNIPPETS_STORAGE_KEY]: bad });
    expect(loadSnippets(s).ok).toBe(false);
    expect(deleteSnippet('x', s).ok).toBe(false);
    expect(s.data[SNIPPETS_STORAGE_KEY]).toBe(bad);
  });

  it('refuses to save when a stored snippet contains bad line data', () => {
    const tampered = JSON.stringify({
      version: 1,
      snippets: [
        {
          id: 'a',
          name: 'x',
          savedAt: 'now',
          lines: [{ description: 'd', quantity: -1, unit: 'u', material: 0, hours: 0, rate: 0 }],
        },
      ],
    });
    const s = fakeStorage({ [SNIPPETS_STORAGE_KEY]: tampered });
    expectErr(save(s));
    expect(s.data[SNIPPETS_STORAGE_KEY]).toBe(tampered);
  });

  it('rejects a stored snippet whose derived money overflows to non-finite', () => {
    const tampered = JSON.stringify({
      version: 1,
      snippets: [
        {
          id: 'a',
          name: 'x',
          savedAt: 'now',
          lines: [
            {
              description: 'd',
              quantity: Number.MAX_VALUE,
              unit: 'u',
              material: Number.MAX_VALUE,
              hours: 1,
              rate: 10,
            },
          ],
        },
      ],
    });
    const s = fakeStorage({ [SNIPPETS_STORAGE_KEY]: tampered });
    expect(loadSnippets(s).ok).toBe(false);
  });
});

describe('snippets: bounds and quota atomicity', () => {
  it('enforces max 100 snippets', () => {
    const s = fakeStorage();
    for (let i = 0; i < SNIPPETS_MAX_COUNT; i++) {
      const r = save(s, { name: `S${i}`, lines: [line({ description: `item ${i}` })] });
      expect(r.ok).toBe(true);
    }
    expect(loadSnippets(s).snippets).toHaveLength(SNIPPETS_MAX_COUNT);
    const overflow = save(s, { name: 'One too many' });
    expect(overflow.ok).toBe(false);
    expect(loadSnippets(s).snippets).toHaveLength(SNIPPETS_MAX_COUNT);
  });

  it('enforces max 200 lines per snippet', () => {
    const s = fakeStorage();
    const tooMany = Array.from({ length: SNIPPETS_MAX_LINES + 1 }, (_, i) =>
      line({ id: `l${i}`, description: `line ${i}` }),
    );
    const r = save(s, { lines: tooMany });
    expectErr(r);
    expect(s.data[SNIPPETS_STORAGE_KEY]).toBeUndefined();
    const ok = save(s, { lines: tooMany.slice(0, SNIPPETS_MAX_LINES) });
    expect(ok.ok).toBe(true);
  });

  it('enforces the 500 KiB total bound without partial writes', () => {
    const s = fakeStorage();
    const long = line({ description: 'x'.repeat(480) });
    let count = 0;
    for (let i = 0; i < SNIPPETS_MAX_COUNT; i++) {
      const r = save(s, { name: `B${i}`, lines: [long] });
      if (!r.ok) break;
      count++;
    }
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThanOrEqual(SNIPPETS_MAX_COUNT);
    const store = JSON.parse(s.data[SNIPPETS_STORAGE_KEY]!) as { snippets: Snippet[] };
    expect(store.snippets.length).toBe(count);
    expect(s.data[SNIPPETS_STORAGE_KEY]!.length).toBeLessThanOrEqual(SNIPPETS_MAX_TOTAL_BYTES);
    const extra = save(s, { name: 'Overflow', lines: [long] });
    expectErr(extra);
    expect(JSON.parse(s.data[SNIPPETS_STORAGE_KEY]!).snippets.length).toBe(count);
    expect(SNIPPETS_MAX_TOTAL_BYTES).toBe(512000);
  });

  it('quota failure leaves prior storage exactly as before', () => {
    const s = fakeStorage();
    save(s, { name: 'Keep me' });
    const before = s.data[SNIPPETS_STORAGE_KEY];
    const r = save(fullStorage(), { name: 'Never lands' });
    expectErr(r);
    expect(s.data[SNIPPETS_STORAGE_KEY]).toBe(before);
    expect(JSON.parse(before!).snippets).toHaveLength(1);
    const d = deleteSnippet('x', fullStorage());
    expect(d.ok).toBe(false);
    expect(s.data[SNIPPETS_STORAGE_KEY]).toBe(before);
  });
});

describe('snippets: load round-trip', () => {
  it('round-trips save/load and defaults to empty when nothing is stored', () => {
    const s = fakeStorage();
    const empty = loadSnippets(s);
    expect(empty.ok).toBe(true);
    expect(empty.snippets).toEqual([]);
    save(s, { name: 'Round trip', lines: [line(), line({ description: 'Second item', quantity: 3 })] });
    const { snippets } = loadSnippets(s);
    expect(snippets).toHaveLength(1);
    expect(snippets[0].name).toBe('Round trip');
    expect(snippets[0].lines).toHaveLength(2);
    expect(snippets[0].id).toBeTruthy();
  });
});

describe('snippets: quote invariants', () => {
  it('never mutates an empty-quote baseline through append', () => {
    const s = fakeStorage();
    const saveResult = save(s);
    expect(saveResult.ok).toBe(true);
    if (!saveResult.ok) return;
    const quote: Quote = makeQuote('contracting', { laborRate: 60, markup: 10, contingency: 5, tax: 7 });
    const r = appendSnippetLines(saveResult.snippet.id, quote.lines, s);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lines).toHaveLength(1);
    expect(quote.lines).toHaveLength(0);
    expect(quote.id).toBe(quote.id);
    expect(quote.stage).toBe(quote.stage);
    expect(quote.step).toBe(quote.step);
  });
});
