import {useRef,useState} from 'react';
import type {Quote} from './domain';
import {portalRequest,prepareApproval,approvalFingerprint,fetchPortalLifecycle,fetchPortalShare} from './portal';
import type {PortalStatus,PortalReceipt,PortalLifecycle,PortalSync} from './portal';
import PortalConnection from './PortalConnection';
const lifecycleFields=(l:PortalLifecycle):Partial<PortalSync>=>({threadId:l.threadId,status:l.status,openedAt:l.openedAt??null,openedCount:l.openedCount,acceptedAt:l.acceptedAt??null,acceptedByName:l.acceptedByName??null,hasShare:l.hasShare});
const formatWhen=(value:string)=>{const time=new Date(value);return Number.isNaN(time.getTime())?value:time.toLocaleString();};
const copyText=async(text:string)=>{try{await navigator.clipboard.writeText(text);}catch{const area=document.createElement('textarea');area.value=text;area.setAttribute('readonly','');area.style.position='fixed';area.style.opacity='0';document.body.appendChild(area);area.select();document.execCommand('copy');area.remove();}};
export default function PortalApproval({quote,canApprove,update}:{quote:Quote;canApprove:boolean;update:(patch:Partial<Quote>,approval?:boolean)=>void}){
  const [status,setStatus]=useState<PortalStatus|null>(null),[clients,setClients]=useState<{id:string;companyName:string}[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[creating,setCreating]=useState(false),[newEmail,setNewEmail]=useState(''),[copied,setCopied]=useState(false);
  const latest=useRef(quote);latest.current=quote;
  const saved=quote.portal?.receipt&&quote.portal.fingerprint===approvalFingerprint(quote);
  const shareUrl=status?.portalUrl&&quote.portal?.sharePath?`${status.portalUrl}${quote.portal.sharePath}`:'';
  const connection=async(s:PortalStatus)=>{setStatus(s);setClients([]);if(s.ready)try{setClients(await portalRequest('clients'));}catch(e){setError((e as Error).message);}};
  const approve=async()=>{
    if(!canApprove||!quote.portal?.clientId||busy)return;
    const current=quote,prepared=prepareApproval(current),pending={...current.portal!,approvalId:prepared.approvalId,fingerprint:prepared.fingerprint,error:undefined,receipt:undefined};
    // Save the retry identity before the request: a lost response can be retried safely.
    update({portal:pending});setBusy(true);setError('');
    try{const receipt=await portalRequest<PortalReceipt>('quotes',prepared.body);
      if(latest.current.id!==current.id||approvalFingerprint(latest.current)!==prepared.fingerprint){setError('The portal saved the earlier revision. Your current edits still need approval.');return;}
      // A new revision invalidates the previous revision's share link and lifecycle cache.
      update({portal:{...pending,receipt,threadId:undefined,status:undefined,openedAt:undefined,openedCount:undefined,acceptedAt:undefined,acceptedByName:undefined,hasShare:undefined,sharePath:undefined},approvedAt:receipt.approvedAt,acknowledged:true},true);
    }catch(e){const message=(e as Error).message;setError(message);if(latest.current.id===current.id&&approvalFingerprint(latest.current)===prepared.fingerprint)update({portal:{...pending,error:message}});}
    finally{setBusy(false);}
  };
  const createCustomer=async()=>{
    const name=String(quote.answers.customer||'').trim();
    if(!name){setError('Add the customer name to the quote first, then create the portal customer.');return;}
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newEmail)){setError('Enter the customer email to create the portal customer.');return;}
    setBusy(true);setError('');
    try{
      const created=await portalRequest<{id:string;companyName:string}>('clients',{companyName:name.slice(0,255),primaryContactName:name.slice(0,255),email:newEmail.trim().slice(0,255)});
      setClients(await portalRequest('clients'));
      update({portal:{clientId:created.id,customerName:created.companyName}});setCreating(false);
    }catch(e){setError((e as Error).message);}
    finally{setBusy(false);}
  };
  const createLink=async()=>{
    const receipt=quote.portal?.receipt;if(!receipt||busy)return;
    setBusy(true);setError('');
    try{const share=await fetchPortalShare(receipt.id);
      update({portal:{...latest.current.portal!,sharePath:share.sharePath,hasShare:true}});
    }catch(e){setError((e as Error).message);}
    finally{setBusy(false);}
  };
  const refreshStatus=async()=>{
    const receipt=quote.portal?.receipt;if(!receipt||busy)return;
    setBusy(true);setError('');
    try{const lifecycle=await fetchPortalLifecycle(receipt.id);
      const current=latest.current.portal!;
      update({portal:{...current,...lifecycleFields(lifecycle),receipt:current.receipt&&lifecycle.projectId?{...current.receipt,projectId:lifecycle.projectId}:current.receipt}});
    }catch(e){setError((e as Error).message);}
    finally{setBusy(false);}
  };
  const shareLink=async()=>{
    if(!shareUrl)return;
    if(typeof navigator.share==='function')try{await navigator.share({title:String(quote.answers.customer||'Your Revive Repair estimate'),url:shareUrl});return;}catch(e){if((e as Error).name==='AbortError')return;}
    await copyText(shareUrl);setCopied(true);
  };
  const portal=quote.portal;
  return <section className="portal-approval"><h3>Approve & save to portal</h3><PortalConnection onStatus={s=>void connection(s)}/>{status?.ready&&<label className="field"><span>Portal customer</span><select disabled={busy||!!portal?.receipt} value={portal?.clientId||''} onChange={e=>{const c=clients.find(c=>c.id===e.target.value);update({portal:{clientId:c?.id||'',customerName:c?.companyName||''}});}}><option value="">Choose the matching customer…</option>{clients.map(c=><option key={c.id} value={c.id}>{c.companyName}</option>)}</select><small>The selected portal customer is {portal?.customerName||'not set'}. Quote is addressed to {String(quote.answers.customer||'not set')}. Confirm these refer to the same customer.</small></label>}
  {status?.ready&&!creating&&!portal?.clientId&&<button className="text-button" onClick={()=>setCreating(true)}>Not in the list? Create “{String(quote.answers.customer||'new customer')}” in the portal</button>}
  {status?.ready&&creating&&<div className="field"><label><span>Customer email (required by the portal)</span><input type="email" value={newEmail} onChange={e=>setNewEmail(e.target.value)} placeholder="customer@company.com"/></label><button className="secondary full" disabled={busy} onClick={()=>void createCustomer()}>Create portal customer & select it</button><button className="text-button" onClick={()=>setCreating(false)}>Cancel</button></div>}
  {portal?.receipt?<div className="portal-success"><strong>Saved to the portal · Revision {portal.receipt.revision}</strong><p>Estimate PDF saved and pending project created. Customer acceptance will activate it and create the SOW.</p>
    {saved?<div className="portal-lifecycle"><h4>Customer review link</h4>
      {shareUrl?<p className="portal-share-link"><a href={shareUrl} target="_blank" rel="noreferrer">{shareUrl}</a></p>:<button className="secondary" disabled={busy} onClick={()=>void createLink()}>Create link</button>}
      {shareUrl&&<div className="portal-share-actions"><button className="secondary" disabled={busy} onClick={()=>void copyText(shareUrl).then(()=>setCopied(true))}>Copy link</button>{typeof navigator.share==='function'&&<button className="secondary" disabled={busy} onClick={()=>void shareLink()}>Share</button>}</div>}
      {copied&&<p role="status">Link copied to the clipboard.</p>}
      <div className="portal-share-actions"><button className="text-button" disabled={busy} onClick={()=>void refreshStatus()}>Refresh status</button></div>
      {portal.status&&<p className="portal-lifecycle-status">Customer status: <strong>{portal.status}</strong>{portal.openedCount!=null&&` · Opened ${portal.openedCount} ${portal.openedCount===1?'time':'times'}`}{portal.openedAt&&` · Last opened ${formatWhen(portal.openedAt)}`}{portal.acceptedByName&&` · Accepted by ${portal.acceptedByName}`}</p>}
      {status?.portalUrl&&<a href={portal.threadId?`${status.portalUrl}/admin/quotes/${portal.threadId}`:`${status.portalUrl}/admin/quotes`} target="_blank" rel="noreferrer">{portal.threadId?'Open portal quote':'Open portal quotes'}</a>}
      {portal.status==='ACCEPTED'&&portal.receipt.projectId&&status?.portalUrl&&<a href={`${status.portalUrl}/admin/projects/${portal.receipt.projectId}`} target="_blank" rel="noreferrer">Open active project</a>}
    </div>:<p>Quote changed — approve a new revision to refresh the customer link.</p>}
    {status?.portalUrl&&<a href={`${status.portalUrl}/admin/quotes`} target="_blank" rel="noreferrer">Open portal quotes</a>}</div>:<button className="primary full" disabled={busy||!canApprove||!status?.ready||!portal?.clientId} onClick={()=>void approve()}>{busy?'Saving approved quote…':portal?.error?'Retry approval & portal save':'Approve & save to portal'}</button>}
  {portal?.receipt&&!saved&&<button className="primary full" disabled={busy||!canApprove||!status?.ready||!portal.clientId} onClick={()=>void approve()}>{busy?'Saving approved quote…':'Approve a new revision & save'}</button>}
  {(error||portal?.error)&&<p role="alert" className="portal-error">{error||portal?.error}</p>}<p className="fine-print">A portal save includes this quote revision, scope, pricing, material research and PDF. It creates a pending project awaiting customer acceptance. Accepting it in the portal activates the project and creates the SOW; nothing is sent automatically. If a request times out, retry to confirm whether it saved.</p></section>;
}
