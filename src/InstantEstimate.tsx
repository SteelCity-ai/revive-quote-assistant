import {useState} from 'react';
type Result={summary:string;total:number;marketLow:number|null;marketMid:number|null;marketHigh:number|null;measuredNote:string;assumptions:string[];followUps:string[]};
const money=(n:number)=>n.toLocaleString('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0});
export default function InstantEstimate(){
  const [address,setAddress]=useState(''),[work,setWork]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[result,setResult]=useState<Result|null>(null);
  const go=async()=>{
    if(!address.trim()||!work){setError('Choose the work type and enter the property address.');return;}
    setBusy(true);setError('');
    try{
      const r=await fetch('/api/instant/estimate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({address,roofWork:work})});
      const data=await r.json();
      if(!r.ok){setError(data.error||'The estimate could not be completed.');return;}
      setResult(data);
    }catch{setError('Connection problem. Please try again.');}
    finally{setBusy(false);}
  };
  return <><header className="header"><div className="brand"><span><b>REVIVE</b><small>INSTANT ROOF ESTIMATE</small></span></div></header>
  <main className="sign-in-shell"><h1>Get an instant roofing estimate.</h1>
  {!result?<>
    <p>Answer two questions. We measure the roof from aerial imagery and research local pricing — in about a minute.</p>
    <label className="field"><span>What does the roof need?</span><select value={work} onChange={e=>setWork(e.target.value)}><option value="">Choose…</option><option>Replacement</option><option>Repair</option><option>Coating / restoration</option><option>New installation</option></select></label>
    <label className="field"><span>Property address (including city and ZIP)</span><input type="text" autoComplete="street-address" value={address} onChange={e=>setAddress(e.target.value)} placeholder="123 High St, Harrisburg, PA 17101"/></label>
    {error&&<p role="alert" className="portal-error">{error}</p>}
    <button className="primary full" disabled={busy||!address.trim()||!work} onClick={()=>void go()}>{busy?'Measuring and pricing…':'Get my estimate'}</button>
    <p className="fine-print">Preliminary only — final pricing follows an on-site confirmation. Nothing is sent or charged.</p>
  </>:<>
    <div className="benchmark-summary"><div><small>Your estimate</small><strong>{money(result.total)}</strong></div>{result.marketMid!==null&&result.marketLow!==null&&result.marketHigh!==null&&<><div><small>Market low</small><strong>{money(result.marketLow)}</strong></div><div><small>Market mid</small><strong>{money(result.marketMid)}</strong></div><div><small>Market high</small><strong>{money(result.marketHigh)}</strong></div></>}</div>
    {result.measuredNote&&<p className="inline-note">{result.measuredNote}</p>}
    <p>{result.summary}</p>
    {result.assumptions.length>0&&<details open><summary>What we assumed</summary><ul>{result.assumptions.map((a,i)=><li key={i}>{a}</li>)}</ul></details>}
    {result.followUps.length>0&&<details><summary>What we would confirm on site</summary><ul>{result.followUps.map((q,i)=><li key={i}>{q}</li>)}</ul></details>}
    <p className="fine-print">This is a preliminary range, not a fixed quote. Call Revive Repair Co. to schedule the on-site confirmation.</p>
    <button className="secondary" onClick={()=>{setResult(null);setAddress('');setWork('');}}>Start over</button>
  </>}</main></>;
}
