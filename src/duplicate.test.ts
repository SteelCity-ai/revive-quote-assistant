import { describe, expect, it } from 'vitest';
import { copyTitle, duplicateQuote, hasSimilarDraft } from './duplicate';
import { defaults, makeQuote, totals } from './domain';
import type { Quote } from './domain';

const line = (id: string, description: string, quantity = 1, material = 0, hours = 0, rate = 0) =>
  ({ id, description, quantity, unit: 'ea', material, hours, rate });

const source = (over: Partial<Quote> = {}): Quote => ({
  ...makeQuote('contracting', { ...defaults, laborRate: 65, markup: 15, contingency: 5, tax: 6 }),
  id: 'src-1',
  stage: 'review',
  answers: { title: 'Union Deposit office build-out', customer: 'Grant Street LLC', address: '88 Smithfield St' },
  lines: [line('l1', 'Framing & drywall', 2, 40, 8, 65), line('l2', 'Painting & finishes', 1, 25, 4, 65)],
  exclusions: 'Permits by others',
  assumptions: 'Normal working hours',
  terms: 'Net 30',
  kind: 'fixed',
  tier: 'standard',
  discountPercent: 5,
  approvedAt: '2026-11-01T00:00:00.000Z',
  acknowledged: true,
  portal: { clientId: 'c1', customerName: 'Grant Street LLC', projectId: 'p1', receipt: { id: 'r1', revision: 1, approvedAt: '2026-11-01T00:00:00.000Z', status: 'APPROVED', projectId: 'p1' } },
  ai: { fingerprint: 'fp-1', assumptions: [], exclusions: [] } as unknown as Quote['ai'],
  ...over,
});

describe('duplicateQuote', () => {
  it('creates a new quote id and new line ids', () => {
    const copy = duplicateQuote(source());
    expect(copy.id).not.toBe('src-1');
    expect(copy.lines).toHaveLength(2);
    expect(copy.lines.map(l => l.id)).not.toContain('l1');
    expect(copy.lines.map(l => l.id)).not.toContain('l2');
    expect(new Set(copy.lines.map(l => l.id)).size).toBe(2);
  });

  it('starts as an unapproved draft with no portal or AI state', () => {
    const copy = duplicateQuote(source());
    expect(copy.approvedAt).toBeUndefined();
    expect(copy.acknowledged).toBe(false);
    expect(copy.portal).toBeUndefined();
    expect(copy.ai).toBeUndefined();
  });

  it('keeps the useful content: answers, lines, pricing settings and terms', () => {
    const src = source();
    const copy = duplicateQuote(src);
    expect(copy.type).toBe(src.type);
    expect(copy.answers.customer).toBe('Grant Street LLC');
    expect(copy.answers.address).toBe('88 Smithfield St');
    expect(copy.lines.map(l => [l.description, l.quantity, l.material, l.hours, l.rate]))
      .toEqual(src.lines.map(l => [l.description, l.quantity, l.material, l.hours, l.rate]));
    expect(copy.pricing).toEqual(src.pricing);
    expect(copy.tier).toBe('standard');
    expect(copy.discountPercent).toBe(5);
    expect(copy.terms).toBe('Net 30');
    expect(copy.kind).toBe('fixed');
  });

  it('keeps the same computed total as the source', () => {
    const src = source();
    const copy = duplicateQuote(src);
    expect(totals(copy.lines, copy.pricing)).toEqual(totals(src.lines, src.pricing));
  });

  it('never mutates the source quote', () => {
    const src = source();
    const before = JSON.stringify(src);
    const copy = duplicateQuote(src);
    copy.answers.customer = 'Changed';
    copy.lines[0].quantity = 99;
    copy.pricing.markup = 50;
    expect(JSON.stringify(src)).toBe(before);
  });

  it('gives the copy a distinct title', () => {
    const copy = duplicateQuote(source());
    expect(copy.answers.title).toBe('Union Deposit office build-out (copy)');
  });

  it('numbers repeated copies instead of stacking markers', () => {
    const first = duplicateQuote(source());
    const second = duplicateQuote(first, [source(), first]);
    const third = duplicateQuote(second, [source(), first, second]);
    expect(first.answers.title).toBe('Union Deposit office build-out (copy)');
    expect(second.answers.title).toBe('Union Deposit office build-out (copy 2)');
    expect(third.answers.title).toBe('Union Deposit office build-out (copy 3)');
  });

  it('handles a quote with no title', () => {
    const copy = duplicateQuote(source({ answers: {} }));
    expect(copy.answers.title).toBe('Untitled quote (copy)');
  });

  it('works on an empty quote with no lines', () => {
    const copy = duplicateQuote(source({ lines: [] }));
    expect(copy.lines).toEqual([]);
    expect(copy.id).not.toBe('src-1');
  });
});

describe('copyTitle', () => {
  it('avoids an existing title', () => {
    const existing = [source({ id: 'x', answers: { title: 'Roof (copy)' } })];
    expect(copyTitle('Roof', existing)).toBe('Roof (copy 2)');
  });

  it('trims whitespace and ignores blank titles', () => {
    expect(copyTitle('   ', [])).toBe('Untitled quote (copy)');
    expect(copyTitle('  Deck rebuild  ', [])).toBe('Deck rebuild (copy)');
  });
});

describe('hasSimilarDraft', () => {
  it('detects an identical draft and ignores the quote itself', () => {
    const src = source();
    const copy = duplicateQuote(src);
    expect(hasSimilarDraft(src, [src])).toBe(false);
    expect(hasSimilarDraft({ ...copy, answers: { ...copy.answers, title: src.answers.title } }, [src])).toBe(true);
  });

  it('does not flag a quote with different lines', () => {
    const src = source();
    const other = source({ id: 'other', lines: [line('z1', 'Flooring', 3, 10, 2, 65)] });
    expect(hasSimilarDraft(other, [src])).toBe(false);
  });
});
