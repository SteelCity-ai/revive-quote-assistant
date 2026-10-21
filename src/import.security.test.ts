import { describe, expect, it } from 'vitest';
import type { Quote } from './domain';
import { parseDraftImport } from './import';

function quote(overrides: Partial<Quote> = {}): Quote {
  return {
    id: 'imported', type: 'roofing', kind: 'estimate', stage: 'review', step: 0,
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    acknowledged: false, answers: { customer: 'Synthetic', address: 'Test property' },
    lines: [{ id: 'line', description: 'Synthetic work', quantity: 1, unit: 'ea', material: 100, hours: 1, rate: 50 }],
    pricing: { laborRate: 50, markup: 15, contingency: 5, tax: 7 },
    exclusions: '', assumptions: '', terms: '', ...overrides,
  };
}
const payload = (q: Quote) => JSON.stringify({ version: 1, quote: q });

describe('import security and financial boundaries', () => {
  it.each(['__proto__', 'constructor', 'prototype'])('rejects hostile own answer key %s before assignment', (key) => {
    const q = quote({ answers: { [key]: 'hostile' } });
    expect(JSON.parse(payload(q)).quote.answers).toHaveProperty(key);
    expect(() => parseDraftImport(payload(q), [])).toThrow(/reserved answer key/i);
  });

  it.each([
    '2026-02-31T00:00:00Z', '2025-02-29T00:00:00Z',
    '2026-01-01T24:00:00Z', 'not-a-date',
  ])('rejects impossible or ambiguous timestamp %s', (createdAt) => {
    expect(() => parseDraftImport(payload(quote({ createdAt })), [])).toThrow(/date/i);
  });

  it.each([
    ['2020-01-01T00:00:00Z', '2020-01-01T00:00:00.000Z'],
    ['2020-01-01T00:00:00.123Z', '2020-01-01T00:00:00.123Z'],
    ['2024-02-29T12:00:00+02:00', '2024-02-29T10:00:00.000Z'],
    ['2024-02-29', '2024-02-29T00:00:00.000Z'],
  ])('accepts valid calendar timestamp %s', (createdAt, expected) => {
    expect(parseDraftImport(payload(quote({ createdAt })), []).quotes[0].createdAt).toBe(expected);
  });

  it('finds same content with reversed answer keys without mutating existing data', () => {
    const existing = quote({ id: 'existing', answers: { address: 'Test property', customer: 'Synthetic' } });
    const before = JSON.stringify(existing);
    expect(parseDraftImport(payload(quote()), [existing]).duplicates).toEqual([0]);
    expect(JSON.stringify(existing)).toBe(before);
  });

  it.each([
    { quantity: 1e12, material: 1e12, hours: 0, rate: 0 },
    { quantity: 1, material: 0, hours: 1e12, rate: 1e12 },
  ])('rejects overflowing line products', (amounts) => {
    const q = quote(); q.lines = [{ ...q.lines[0], ...amounts }];
    expect(() => parseDraftImport(payload(q), [])).toThrow(/maximum supported money/i);
  });

  it('rejects aggregate overflow even when each line product is within its cap', () => {
    const q = quote();
    q.lines = ['a', 'b'].map((id) => ({ id, description: 'Synthetic', quantity: 1, unit: 'ea', material: 7.5e11, hours: 0, rate: 0 }));
    expect(() => parseDraftImport(payload(q), [])).toThrow(/aggregate/i);
  });

  it('rejects aggregate multiplication above the cap despite bounded raw inputs', () => {
    const q = quote(); q.pricing.markup = 1e12; q.pricing.contingency = 0;
    q.lines = [{ ...q.lines[0], quantity: 1, material: 1e6, hours: 0 }];
    expect(() => parseDraftImport(payload(q), [])).toThrow(/aggregate/i);
  });

  it('still accepts the application capped-discount calculation', () => {
    expect(parseDraftImport(payload(quote({ discountPercent: 100 })), []).quotes).toHaveLength(1);
  });
});
