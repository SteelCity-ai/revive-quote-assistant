import {it,expect,vi,afterEach} from 'vitest';
import {makeQuote,defaults} from './domain';
import {prepareApproval,portalSnapshot,approvalFingerprint,fetchPortalLifecycle,fetchPortalShare,rotatePortalShare} from './portal';
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
it('invalidates the saved state and customer link when the quote is edited after a save',()=>{
  const q=makeQuote('contracting',defaults);
  q.portal={clientId:'customer',customerName:'Customer'};
  q.portal={...q.portal,fingerprint:approvalFingerprint(q)};
  expect(q.portal.fingerprint===approvalFingerprint(q)).toBe(true);
  q.terms='Customer asked for a different start date.';
  expect(q.portal.fingerprint===approvalFingerprint(q)).toBe(false);
});
const mockFetch=(respond:(path:string,method:string)=>unknown)=>{
  const calls:string[]=[];
  vi.stubGlobal('fetch',vi.fn(async(path:any,init?:RequestInit)=>{
    const method=init?.method||'GET';calls.push(`${method} ${String(path)}`);
    return new Response(JSON.stringify(respond(String(path),method)),{status:200,headers:{'Content-Type':'application/json'}});
  }));
  return calls;
};
afterEach(()=>vi.unstubAllGlobals());
it('fetches quote lifecycle and share links through the local portal proxy',async()=>{
  const calls=mockFetch(path=>path.endsWith('/quotes/rev-1/share')?{shareToken:'token-1',sharePath:'/q/token-1'}:{id:'rev-1',threadId:'thread-1',revision:2,approvedAt:'2026-09-26T10:00:00Z',status:'APPROVED',title:'Roof repair',customer:'Pat',total:1234.5,clientId:'client-1',projectId:null,openedAt:null,openedCount:0,acceptedAt:null,acceptedByName:null,hasShare:false});
  const lifecycle=await fetchPortalLifecycle('rev-1');
  expect(lifecycle).toEqual(expect.objectContaining({id:'rev-1',threadId:'thread-1',revision:2,status:'APPROVED',openedCount:0}));
  const share=await fetchPortalShare('rev-1');
  expect(share).toEqual({shareToken:'token-1',sharePath:'/q/token-1'});
  await rotatePortalShare('rev-1');
  expect(calls).toEqual(['GET /api/portal/quotes/rev-1','GET /api/portal/quotes/rev-1/share','POST /api/portal/quotes/rev-1/share']);
});
it('tolerates lifecycle payloads where optional fields arrive later',async()=>{
  mockFetch(()=>({id:'rev-2',threadId:'thread-2',revision:1,approvedAt:'2026-09-26T10:00:00Z',status:'SUPERSEDED'}));
  const lifecycle=await fetchPortalLifecycle('rev-2');
  expect(lifecycle.status).toBe('SUPERSEDED');
  expect(lifecycle.openedAt).toBeUndefined();expect(lifecycle.openedCount).toBeUndefined();
  expect(lifecycle.acceptedByName).toBeUndefined();expect(lifecycle.hasShare).toBeUndefined();
});
