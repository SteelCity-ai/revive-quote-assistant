import {useEffect,useRef,useState} from 'react';
import {CANCEL_NOTICE,WAIT_SUMMARY,elapsedLabel,isAbortError,waitHint} from './instantWait';
type Result={summary:string;total:number;marketLow:number|null;marketMid:number|null;marketHigh:number|null;measuredNote:string;assumptions:string[];followUps:string[];cached?:boolean;cachedAt?:string|null};
const money=(n:number)=>n.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
const CONSENT_TEXT='I agree that Revive Repair Co. may contact me about this estimate. My name, email and phone are saved only if I tick this box.';
export default function InstantEstimate(){
  const [address,setAddress]=useState(''),[work,setWork]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<Result|null>(null);
  const [name,setName]=useState(''),[email,setEmail]=useState(''),[phone,setPhone]=useState(''),[consent,setConsent]=useState(false);
  const [stopped,setStopped]=useState(false),[elapsed,setElapsed]=useState(0);
  const abortRef=useRef<AbortController|null>(null);
  useEffect(()=>{
    if(!busy){setElapsed(0);return;}
    const startedAt=Date.now();
    const timer=setInterval(()=>setElapsed(Date.now()-startedAt),1000);
    return()=>clearInterval(timer);
  },[busy]);
  useEffect(()=>()=>abortRef.current?.abort(),[]);
  const reset=()=>{setResult(null);setAddress('');setWork('');setName('');setEmail('');setPhone('');setConsent(false);setStopped(false);setError('');};
  const cancel=()=>{abortRef.current?.abort();};
  const go=async()=>{
    if(!address.trim()||!work){setError('Choose the work type and enter the property address.');return;}
    const contact={name:name.trim(),email:email.trim(),phone:phone.trim()};
    const hasContact=Boolean(contact.name||contact.email||contact.phone);
    if(hasContact&&!consent){setError('Tick the permission box to save your contact details, or clear them to get a price without contact.');return;}
    abortRef.current?.abort();
    const controller=new AbortController();
    abortRef.current=controller;
    setBusy(true);setError('');setStopped(false);
    try{
      const r=await fetch('/api/instant/estimate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({address,roofWork:work,contact,consent}),signal:controller.signal});
      const data=await r.json();
      if(!r.ok){setError(data.error||'The estimate could not be completed.');return;}
      setResult(data);
    }catch(caught){
      // A visitor who stops waiting keeps every answer for a one-click retry.
      if(isAbortError(caught))setStopped(true);
      else setError('Connection problem. Please try again.');
    }finally{
      if(abortRef.current===controller)abortRef.current=null;
      setBusy(false);
    }
  };
  return <><header className="header"><div className="brand"><span><b>REVIVE</b><small>INSTANT ROOF ESTIMATE</small></span></div></header>
  <main className="sign-in-shell"><h1>Get an instant roofing estimate.</h1>
  {!result?<>
    <p>Answer two questions. We measure the roof from aerial imagery and research local pricing — in about a minute.</p>
    <label className="field"><span>What does the roof need?</span><select value={work} onChange={e=>setWork(e.target.value)}><option value="">Choose…</option><option>Replacement</option><option>Repair</option><option>Coating / restoration</option><option>New installation</option></select></label>
    <label className="field"><span>Property address (including city and ZIP)</span><input type="text" autoComplete="street-address" value={address} onChange={e=>setAddress(e.target.value)} placeholder="123 High St, Harrisburg, PA 17101"/></label>
    <p className="fine-print">Want us to follow up? These contact details are optional.</p>
    <label className="field"><span>Name</span><input type="text" autoComplete="name" value={name} onChange={e=>setName(e.target.value)} placeholder="Your name"/></label>
    <label className="field"><span>Email</span><input type="email" autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/></label>
    <label className="field"><span>Phone</span><input type="tel" autoComplete="tel" value={phone} onChange={e=>setPhone(e.target.value)} placeholder="(555) 555-5555"/></label>
    <label className="acknowledge"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/><span>{CONSENT_TEXT}</span></label>
    {error&&<p role="alert" className="portal-error">{error}</p>}
    {stopped&&!busy&&<p role="status" className="inline-note">{CANCEL_NOTICE}</p>}
    <button className="primary full" disabled={busy||!address.trim()||!work} onClick={()=>void go()}>{busy?'Measuring and pricing…':'Get my estimate'}</button>
    {busy&&<>
      <div className="wait-panel" role="status" aria-live="polite">
        <p>{WAIT_SUMMARY}</p>
        <p>{waitHint(elapsed)}</p>
      </div>
      <p className="fine-print">Elapsed <span aria-hidden="true">{elapsedLabel(elapsed)}</span><span className="sr-only">{elapsedLabel(elapsed)} minutes and seconds</span></p>
      <button className="secondary full" onClick={cancel}>Stop waiting</button>
    </>}
    <p className="fine-print">Preliminary only — final pricing follows an on-site confirmation. Nothing is sent or charged.</p>
  </>:<>
    <div className="benchmark-summary"><div><small>Your estimate</small><strong>{money(result.total)}</strong></div>{result.marketMid!==null&&result.marketLow!==null&&result.marketHigh!==null&&<><div><small>Market low</small><strong>{money(result.marketLow)}</strong></div><div><small>Market mid</small><strong>{money(result.marketMid)}</strong></div><div><small>Market high</small><strong>{money(result.marketHigh)}</strong></div></>}</div>
    {result.cached&&<p className="inline-note">This reuses a recent estimate for the same address and roof details.</p>}
    {result.measuredNote&&<p className="inline-note">{result.measuredNote}</p>}
    <p>{result.summary}</p>
    {result.assumptions.length>0&&<details open><summary>What we assumed</summary><ul>{result.assumptions.map((a,i)=><li key={i}>{a}</li>)}</ul></details>}
    {result.followUps.length>0&&<details><summary>What we would confirm on site</summary><ul>{result.followUps.map((q,i)=><li key={i}>{q}</li>)}</ul></details>}
    <p className="fine-print">This is a preliminary range, not a fixed quote. Call Revive Repair Co. to schedule the on-site confirmation.</p>
    <button className="secondary" onClick={reset}>Start over</button>
  </>}</main></>;
}
