import { describe, expect, it } from 'vitest';
import { countByStatus, filterQuotes, matchesStatus, searchableText } from './quoteFilter';
import { defaults, makeQuote } from './domain';
import type { Quote } from './domain';

const quote = (type: Quote['type'], over: Partial<Quote> = {}): Quote => ({ ...makeQuote(type, { ...defaults }), ...over });
const approved = quote('roofing', { id: 'a1', answers: { title: 'Roof replacement', customer: 'North Hills Dental', address: '12 Elm St' }, approvedAt: '2026-11-01T00:00:00.000Z' });
const draft = quote('contracting', { id: 'd1', answers: { title: 'Office build-out', customer: 'Grant Street LLC', address: '88 Smithfield St' } });
const unlabelled = quote('renovation', { id: 'd2', answers: {} });
const quotes = [approved, draft, unlabelled];

describe('filterQuotes', () => {
  it('returns every quote for an empty query and the all filter', () => {
    expect(filterQuotes(quotes, '')).toHaveLength(3);
    expect(filterQuotes(quotes, '   ')).toHaveLength(3);
  });

  it('matches title, customer and address without case sensitivity', () => {
    expect(filterQuotes(quotes, 'DENTAL').map(q => q.id)).toEqual(['a1']);
    expect(filterQuotes(quotes, 'smithfield').map(q => q.id)).toEqual(['d1']);
    expect(filterQuotes(quotes, 'build-out').map(q => q.id)).toEqual(['d1']);
  });

  it('requires every word to match', () => {
    expect(filterQuotes(quotes, 'grant street').map(q => q.id)).toEqual(['d1']);
    expect(filterQuotes(quotes, 'grant dental')).toHaveLength(0);
  });

  it('collapses repeated spaces and ignores surrounding whitespace', () => {
    expect(filterQuotes(quotes, '  north   hills  ').map(q => q.id)).toEqual(['a1']);
  });

  it('applies the status filter together with the query', () => {
    expect(filterQuotes(quotes, '', 'draft').map(q => q.id)).toEqual(['d1', 'd2']);
    expect(filterQuotes(quotes, '', 'approved').map(q => q.id)).toEqual(['a1']);
    expect(filterQuotes(quotes, 'grant', 'approved')).toHaveLength(0);
  });

  it('keeps the caller ordering instead of re-sorting', () => {
    expect(filterQuotes([draft, approved], '').map(q => q.id)).toEqual(['d1', 'a1']);
  });

  it('does not treat an approved draft as a draft', () => {
    expect(matchesStatus(approved, 'draft')).toBe(false);
    expect(matchesStatus(approved, 'approved')).toBe(true);
    expect(matchesStatus(draft, 'approved')).toBe(false);
  });

  it('searches the job name so a person can find quotes by trade', () => {
    expect(searchableText(approved)).toContain('roofing');
    expect(filterQuotes(quotes, 'roofing').map(q => q.id)).toEqual(['a1']);
  });
});

describe('countByStatus', () => {
  it('counts drafts and approved quotes for the filter labels', () => {
    expect(countByStatus(quotes)).toEqual({ all: 3, approved: 1, draft: 2 });
    expect(countByStatus([])).toEqual({ all: 0, approved: 0, draft: 0 });
  });
});
