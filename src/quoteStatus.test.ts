import { describe, expect, it } from 'vitest';
import { approvalFingerprint } from './portal';
import { defaults, makeQuote } from './domain';
import type { Quote } from './domain';
import { quoteStatus } from './quoteStatus';

const savedQuote = (): Quote => {
  const base: Quote = { ...makeQuote('roofing', defaults), answers: { title: 'North roof', customer: 'Acme' } };
  const portal = { clientId: 'client-1', customerName: 'Acme' };
  const fingerprint = approvalFingerprint({ ...base, portal });
  return {
    ...base,
    approvedAt: '2026-11-17T12:00:00.000Z',
    acknowledged: true,
    portal: {
      ...portal,
      fingerprint,
      approvalId: 'approval-1',
      receipt: { id: 'rev-1', revision: 2, approvedAt: '2026-11-17T12:00:00.000Z', status: 'APPROVED', projectId: null },
    },
  };
};

describe('quoteStatus', () => {
  it('marks a new quote as a draft that is not in the portal', () => {
    expect(quoteStatus(makeQuote('renovation', defaults))).toEqual({ key: 'draft', label: 'DRAFT', detail: 'Not in the portal' });
  });

  it('keeps an approved quote that was never saved to the portal visible as unsaved work', () => {
    const quote: Quote = { ...makeQuote('renovation', defaults), approvedAt: '2026-11-17T12:00:00.000Z' };
    expect(quoteStatus(quote)).toEqual({ key: 'approved', label: 'APPROVED', detail: 'Not in the portal' });
  });

  it('does not claim a portal save while the receipt is still missing', () => {
    const quote: Quote = { ...makeQuote('renovation', defaults), portal: { clientId: 'c1', customerName: 'Acme', fingerprint: 'pending' } };
    expect(quoteStatus(quote)).toEqual({ key: 'unsaved', label: 'NOT IN PORTAL', detail: 'Portal save not confirmed' });
  });

  it('reports the last failed portal save instead of a stale success', () => {
    const quote: Quote = { ...makeQuote('renovation', defaults), portal: { clientId: 'c1', customerName: 'Acme', error: 'Timed out' } };
    expect(quoteStatus(quote)).toEqual({ key: 'unsaved', label: 'NOT IN PORTAL', detail: 'The last portal save failed' });
  });

  it('shows the saved revision for the current quote', () => {
    expect(quoteStatus(savedQuote())).toEqual({ key: 'portal', label: 'IN PORTAL', detail: 'Portal rev 2' });
  });

  it('includes how often the customer opened the link', () => {
    const quote = savedQuote();
    const status = quoteStatus({ ...quote, portal: { ...quote.portal!, openedCount: 3 } });
    expect(status.detail).toBe('Portal rev 2 · viewed 3 times');
  });

  it('uses the singular for one view', () => {
    const quote = savedQuote();
    const status = quoteStatus({ ...quote, portal: { ...quote.portal!, openedCount: 1 } });
    expect(status.detail).toBe('Portal rev 2 · viewed 1 time');
  });

  it('flags local edits that were never saved as a new revision', () => {
    const quote = savedQuote();
    const status = quoteStatus({ ...quote, terms: 'Changed payment terms' });
    expect(status).toEqual({ key: 'changed', label: 'CHANGED', detail: 'Local edits not saved · Portal rev 2' });
  });

  it('shows customer acceptance with the saved revision', () => {
    const quote = savedQuote();
    const status = quoteStatus({ ...quote, portal: { ...quote.portal!, status: 'ACCEPTED', acceptedByName: 'Dana Reed' } });
    expect(status).toEqual({ key: 'accepted', label: 'ACCEPTED', detail: 'Customer accepted · Portal rev 2' });
  });

  it('flags a revision the portal has already replaced', () => {
    const quote = savedQuote();
    const status = quoteStatus({ ...quote, portal: { ...quote.portal!, status: 'SUPERSEDED' } });
    expect(status.key).toBe('superseded');
    expect(status.detail).toBe('Portal rev 2 was replaced — save a new revision');
  });

  it('treats a matching receipt without lifecycle data as saved', () => {
    const quote = savedQuote();
    const status = quoteStatus({ ...quote, portal: { ...quote.portal!, status: undefined, openedCount: undefined } });
    expect(status.key).toBe('portal');
    expect(status.detail).toBe('Portal rev 2');
  });
});
