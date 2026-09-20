import {it,expect} from 'vitest';
import {makeQuote,defaults} from './domain';
import {prepareApproval,portalSnapshot} from './portal';
it('reuses retry identity for the exact approval but creates a new one after edits',()=>{
  const q=makeQuote('contracting',defaults);q.portal={clientId:'customer',customerName:'Customer'};
  const first=prepareApproval(q);q.portal={...q.portal,...first};
  expect(prepareApproval(q).approvalId).toBe(first.approvalId);
  q.terms='Changed terms';expect(prepareApproval(q).approvalId).not.toBe(first.approvalId);
});
it('does not upload local navigation state or sync receipts as quote content',()=>{
  const q=makeQuote('roofing',defaults);q.portal={clientId:'customer',customerName:'Customer'};
  expect(portalSnapshot(q)).not.toHaveProperty('portal');expect(portalSnapshot(q)).not.toHaveProperty('step');
});
