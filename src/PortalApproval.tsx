import {useRef,useState} from 'react';
import type {Quote} from './domain';
import {portalRequest,prepareApproval,approvalFingerprint} from './portal';
import type {PortalStatus,PortalReceipt} from './portal';
import PortalConnection from './PortalConnection';
export default function PortalApproval({quote,canApprove,update}:{quote:Quote;canApprove:boolean;update:(patch:Partial<Quote>,approval?:boolean)=>void}){
  const [status,setStatus]=useState<PortalStatus|null>(null),[clients,setClients]=useState<{id:string;companyName:string}[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const latest=useRef(quote);latest.current=quote;
  const saved=quote.portal?.receipt&&quote.portal.fingerprint===approvalFingerprint(quote);
  const connection=async(s:PortalStatus)=>{setStatus(s);setClients([]);if(s.ready)try{setClients(await portalRequest('clients'));}catch(e){setError((e as Error).message);}};
  const approve=async()=>{
    if(!canApprove||!quote.portal?.clientId||busy)return;
    const current=quote,prepared=prepareApproval(current),pending={...current.portal!,approvalId:prepared.approvalId,fingerprint:prepared.fingerprint,error:undefined,receipt:undefined};
    // Save the retry identity before the request: a lost response can be retried safely.
    update({portal:pending});setBusy(true);setError('');
    try{const receipt=await portalRequest<PortalReceipt>('quotes',prepared.body);
      if(latest.current.id!==current.id||approvalFingerprint(latest.current)!==prepared.fingerprint){setError('The portal saved the earlier revision. Your current edits still need approval.');return;}
      update({portal:{...pending,receipt},approvedAt:receipt.approvedAt,acknowledged:true},true);
    }catch(e){const message=(e as Error).message;setError(message);if(latest.current.id===current.id&&approvalFingerprint(latest.current)===prepared.fingerprint)update({portal:{...pending,error:message}});}
    finally{setBusy(false);}
  };
  return <section className="portal-approval"><h3>Approve & save to portal</h3><PortalConnection onStatus={s=>void connection(s)}/>{status?.ready&&<label className="field"><span>Portal customer</span><select disabled={busy||!!quote.portal?.receipt} value={quote.portal?.clientId||''} onChange={e=>{const c=clients.find(c=>c.id===e.target.value);update({portal:{clientId:c?.id||'',customerName:c?.companyName||''}});}}><option value="">Choose the matching customer…</option>{clients.map(c=><option key={c.id} value={c.id}>{c.companyName}</option>)}</select><small>The selected portal customer is {quote.portal?.customerName||'not set'}. Quote is addressed to {String(quote.answers.customer||'not set')}. Confirm these refer to the same customer.</small></label>}{status?.ready&&<a href={`${status.portalUrl}/admin/clients/new`} target="_blank" rel="noreferrer">Add a new customer in the portal</a>}
  {saved?<div className="portal-success"><strong>Saved to the portal · Revision {quote.portal!.receipt!.revision}</strong><p>Estimate PDF saved and pending project created. Customer acceptance will activate it and create the SOW.</p>{status?.portalUrl&&<a href={`${status.portalUrl}/admin/quotes`} target="_blank" rel="noreferrer">Open portal quotes</a>}</div>:<button className="primary full" disabled={busy||!canApprove||!status?.ready||!quote.portal?.clientId} onClick={()=>void approve()}>{busy?'Saving approved quote…':quote.portal?.error?'Retry approval & portal save':'Approve & save to portal'}</button>}
  {(error||quote.portal?.error)&&<p role="alert" className="portal-error">{error||quote.portal?.error}</p>}<p className="fine-print">A portal save includes this quote revision, scope, pricing, material research and PDF. It creates a pending project awaiting customer acceptance. Accepting it in the portal activates the project and creates the SOW; nothing is sent automatically. If a request times out, retry to confirm whether it saved.</p></section>;
}
