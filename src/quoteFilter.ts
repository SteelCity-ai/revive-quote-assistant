import { jobNames } from './domain';
import type { Quote } from './domain';

export type QuoteStatusFilter = 'all' | 'draft' | 'approved';

const normalise = (value: unknown) => String(value ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Text a person can see on a quote row, used for search matching. */
export function searchableText(quote: Quote) {
  return normalise([quote.answers.title, quote.answers.customer, quote.answers.address, jobNames[quote.type]].join(' '));
}

export function matchesStatus(quote: Quote, status: QuoteStatusFilter) {
  if (status === 'all') return true;
  return status === 'approved' ? Boolean(quote.approvedAt) : !quote.approvedAt;
}

/**
 * Every word in the query must appear somewhere in the quote's visible text.
 * Filtering never reorders: callers keep their own newest-first ordering.
 */
export function filterQuotes(quotes: Quote[], query: string, status: QuoteStatusFilter = 'all') {
  const terms = normalise(query).split(' ').filter(Boolean);
  return quotes.filter(quote => {
    if (!matchesStatus(quote, status)) return false;
    if (terms.length === 0) return true;
    const text = searchableText(quote);
    return terms.every(term => text.includes(term));
  });
}

export function countByStatus(quotes: Quote[]) {
  const approved = quotes.filter(quote => Boolean(quote.approvedAt)).length;
  return { all: quotes.length, approved, draft: quotes.length - approved };
}
