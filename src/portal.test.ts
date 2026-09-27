import {it,expect,vi,afterEach} from 'vitest';
import {makeQuote,defaults} from './domain';
import {prepareApproval,portalSnapshot,approvalFingerprint,fetchPortalLifecycle,fetchPortalShare,rotatePortalShare,fetchPortalAssemblies,fetchPortalAssembly,assemblyToQuoteLines} from './portal';
import type {PortalAssembly} from './portal';
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
const assemblyTemplate:PortalAssembly={id:'a1b2c3d4-0000-4000-8000-00000000aa01',slug:'tpo-replacement',name:'TPO replacement',trade:'Roofing',description:'Full tear-off TPO system',lineCount:4,lines:[
  {kind:'material',description:'TPO membrane 60 mil',quantity:2000,unit:'sq ft',unitCost:1.2,wasteFactorPercent:10,sort:1},
  {kind:'labor',description:'Tear-off and install crew',quantity:16,unit:'hrs',unitCost:65,wasteFactorPercent:null,sort:2},
  {kind:'accessory',description:'Fasteners and plates',quantity:4,unit:'box',unitCost:0,wasteFactorPercent:null,sort:3},
  {kind:'exclusion',description:'Interior ceiling repairs',quantity:0,unit:'',unitCost:0,wasteFactorPercent:null,sort:4},
]};
it('maps assembly templates into quote lines, keeping the quote pricing settings',()=>{
  const pricing={...defaults,laborRate:75};
  const lines=assemblyToQuoteLines(assemblyTemplate,pricing);
  expect(lines).toHaveLength(4);
  const membrane=lines[0];
  expect(membrane).toMatchObject({description:'TPO membrane 60 mil',quantity:2000,unit:'sq ft',material:1.2,hours:0,rate:75});
  const labor=lines[1];
  expect(labor).toMatchObject({description:'Tear-off and install crew',material:0,hours:16,rate:65});
  expect(labor.quantity*labor.material+labor.hours*labor.rate).toBe(16*65);
  const allowance=lines[2];
  expect(allowance).toMatchObject({description:'Fasteners and plates',unit:'allowance',material:0,hours:0});
  const exclusion=lines[3];
  expect(exclusion).toMatchObject({description:'Interior ceiling repairs',quantity:0,unit:'exclusion',material:0,hours:0});
  expect(lines.filter(l=>l!==labor).every(l=>l.rate===75)).toBe(true); // quote's own labor rate on non-labor lines
});
it('degrades tolerantly when assembly payloads are incomplete',()=>{
  const pricing={...defaults,laborRate:75};
  expect(assemblyToQuoteLines({...assemblyTemplate,lines:undefined},pricing)).toEqual([]);
  const sparse=assemblyToQuoteLines({id:'x',name:'Sparse',lines:[{kind:'waste',description:'Disposal',quantity:1,unit:'',unitCost:0},{kind:'labor',description:'Crew',quantity:2,unit:'hrs',unitCost:0}]},pricing);
  expect(sparse.every(l=>l.unit==='allowance'&&l.material===0)).toBe(true);
});
it('fetches assembly templates through the local portal proxy and tolerates the API arriving later',async()=>{
  const calls=mockFetch(path=>path.endsWith('/assemblies/a1b2c3d4-0000-4000-8000-00000000aa01')?assemblyTemplate:{items:[assemblyTemplate]});
  const list=await fetchPortalAssemblies();
  expect(list.items).toHaveLength(1);
  const one=await fetchPortalAssembly('a1b2c3d4-0000-4000-8000-00000000aa01');
  expect(one.name).toBe('TPO replacement');
  expect(calls).toEqual(['GET /api/portal/assemblies','GET /api/portal/assemblies/a1b2c3d4-0000-4000-8000-00000000aa01']);
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({error:'Not found'}),{status:404,headers:{'Content-Type':'application/json'}})));
  await expect(fetchPortalAssemblies()).rejects.toThrow(); // Review hides the picker when the proxy 404s
  await expect(fetchPortalAssembly('a1b2c3d4-0000-4000-8000-00000000aa01')).rejects.toThrow();
});
