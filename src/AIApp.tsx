import {useEffect,useRef,useState} from 'react';
import {Header} from './components';
import Home from './Home';
import Guide from './Guide';
import Estimate from './Estimate';
import Review from './Review';
import Settings from './Settings';
import Generating from './Generating';
import {makeQuote,questions} from './domain';
import type {JobType,Quote} from './domain';
import {generate,fingerprint} from './ai';
import {download,load,save} from './storage';
import VoicePanel from './VoicePanel';
export default function AIApp(){
  const [loaded]=useState(load);const [data,setData]=useState(loaded.data);const [storageError,setStorageError]=useState(loaded.error);
  const [activeId,setActiveId]=useState<string|null>(null);const [settings,setSettings]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const controller=useRef<AbortController|null>(null);const pristine=useRef(true);
  useEffect(()=>{if(pristine.current){pristine.current=false;return;}if(loaded.error)return;try{save(data);setStorageError('');}catch{setStorageError('Device storage is unavailable or full. Export a backup before leaving.');}},[data,loaded.error]);
  useEffect(()=>()=>controller.current?.abort(),[]);
  const quote=data.quotes.find(q=>q.id===activeId);
  const update=(patch:Partial<Quote>,approval=false)=>setData(current=>({...current,quotes:current.quotes.map(q=>q.id!==activeId?q:{...q,...patch,updatedAt:new Date().toISOString(),approvedAt:approval?patch.approvedAt:undefined,acknowledged:approval?q.acknowledged:patch.acknowledged??false})}));
  const cancel=()=>{controller.current?.abort();controller.current=null;setBusy(false);setError('');};
  const home=()=>{cancel();setActiveId(null);setSettings(false);window.scrollTo({top:0});};
  const start=(type:JobType)=>{const q=makeQuote(type,data.pricing);setData(d=>({...d,quotes:[q,...d.quotes]}));setActiveId(q.id);window.scrollTo({top:0});};
  const research=async(force=false)=>{
    if(!quote)return;
    if(!force&&quote.ai?.fingerprint===fingerprint(quote)){update({stage:'pricing'});return;}
    if(quote.lines.length&&!error&&!window.confirm('Prepare a new researched estimate? This replaces current line items, AI assumptions and exclusions. Your job answers and terms are kept.'))return;
    controller.current?.abort();const abort=new AbortController();controller.current=abort;const snapshot=quote;
    setError('');setBusy(true);window.scrollTo({top:0});
    try{const {report,lines}=await generate(snapshot,abort.signal);if(abort.signal.aborted||controller.current!==abort)return;
      setData(current=>({...current,quotes:current.quotes.map(q=>q.id!==snapshot.id||fingerprint(q)!==fingerprint(snapshot)?q:{...q,stage:'pricing',lines,ai:report,assumptions:report.assumptions.join('\n'),exclusions:report.exclusions.join('\n'),approvedAt:undefined,acknowledged:false,updatedAt:new Date().toISOString()})}));setBusy(false);
    }catch(e){if(!abort.signal.aborted){setError(e instanceof Error?e.message:'Could not prepare the estimate. Please retry.');setBusy(false);}}
  };
  const navigate=(stage:Quote['stage'])=>{update({stage});window.scrollTo({top:0});};
  const voiceStart=(type:JobType,address:string)=>{const q=makeQuote(type,data.pricing);q.answers={address};setData(d=>({...d,quotes:[q,...d.quotes]}));setActiveId(q.id);window.scrollTo({top:0});};
  return <><Header home={home} settings={()=>{cancel();setSettings(true);}} saved={!storageError}/>{storageError&&<div role="alert" className="storage-warning">{storageError}</div>}
    {(busy||error)&&quote?<Generating error={error} retry={()=>void research(true)} cancel={cancel}/>:settings?<Settings pricing={data.pricing} change={pricing=>setData(d=>({...d,pricing}))} back={()=>setSettings(false)} backup={()=>download(`revive-quotes-backup-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(data,null,2))}/>:quote?quote.stage==='guide'?<Guide quote={quote} update={update} exit={home} connections={()=>setSettings(true)} finish={()=>void research()}/>:quote.stage==='pricing'?<Estimate quote={quote} update={update} regenerate={()=>void research(true)} back={()=>{update({stage:'guide',step:Math.min(quote.step,questions(quote.type,quote.answers).length-1)});window.scrollTo({top:0});}} next={()=>navigate('review')}/>:<Review quote={quote} update={update} edit={stage=>{update({stage,...(stage==='guide'?{step:0}:{})});window.scrollTo({top:0});}} home={home} remove={()=>{setData(d=>({...d,quotes:d.quotes.filter(q=>q.id!==activeId)}));home();}}/>:<Home quotes={data.quotes} start={start} resume={id=>{setActiveId(id);window.scrollTo({top:0});}} settings={()=>setSettings(true)}/>}<VoicePanel quote={quote??null} update={update} research={research} busy={busy} error={error} startVoiceQuote={voiceStart}/></>;
}
