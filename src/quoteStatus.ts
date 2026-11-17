import { approvalFingerprint } from './portal';
import type { Quote } from './domain';

// What the quote list can honestly say about where a quote stands.
// A portal receipt is only current while the saved fingerprint still matches the quote,
// so local edits after a save are shown instead of a stale "in portal" claim.
export type QuoteStatusKey = 'draft' | 'approved' | 'unsaved' | 'portal' | 'changed' | 'accepted' | 'superseded';

export type QuoteStatus = {
  key: QuoteStatusKey;
  label: string;
  detail: string;
};

const revisionLabel = (revision: number) => `Portal rev ${revision}`;

export function quoteStatus(quote: Quote): QuoteStatus {
  const portal = quote.portal;
  const receipt = portal?.receipt;
  if (!receipt) {
    if (portal?.fingerprint && !portal.error) return { key: 'unsaved', label: 'NOT IN PORTAL', detail: 'Portal save not confirmed' };
    if (portal?.error) return { key: 'unsaved', label: 'NOT IN PORTAL', detail: 'The last portal save failed' };
    return quote.approvedAt
      ? { key: 'approved', label: 'APPROVED', detail: 'Not in the portal' }
      : { key: 'draft', label: 'DRAFT', detail: 'Not in the portal' };
  }
  const revision = receipt.revision;
  if (portal?.status === 'ACCEPTED') return { key: 'accepted', label: 'ACCEPTED', detail: `Customer accepted · ${revisionLabel(revision)}` };
  if (portal?.status === 'SUPERSEDED') return { key: 'superseded', label: 'SUPERSEDED', detail: `${revisionLabel(revision)} was replaced — save a new revision` };
  if (portal?.fingerprint !== approvalFingerprint(quote)) return { key: 'changed', label: 'CHANGED', detail: `Local edits not saved · ${revisionLabel(revision)}` };
  const opened = portal?.openedCount ?? 0;
  const viewed = opened > 0 ? ` · viewed ${opened} time${opened === 1 ? '' : 's'}` : '';
  return { key: 'portal', label: 'IN PORTAL', detail: `${revisionLabel(revision)}${viewed}` };
}
