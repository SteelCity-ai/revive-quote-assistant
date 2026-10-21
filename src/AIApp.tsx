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
import type {SavedState} from './storage';
import VoicePanel from './VoicePanel';
import DraftImport from './DraftImport';
import {portalRequest,type PortalProject} from './portal';
import {loadQuoteHistory,mergeQuoteHistory,restoreSnapshot,type QuoteSnapshot} from './history';
export default function AIApp(){
  const [loaded]=useState(load);const [data,setData]=useState(loaded.data);const [storageError,setStorageError]=useState(loaded.error);
  const [activeId,setActiveId]=useState<string|null>(null);const [settings,setSettings]=useState(false);const [importOpen,setImportOpen]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const [historyState,setHistoryState]=useState<{snapshots:QuoteSnapshot[];error:string}>(()=>loadQuoteHistory(''));
  const [historyError,setHistoryError]=useState('');
  const controller=useRef<AbortController|null>(null);const pristine=useRef(true);
  const handoff=useRef(false);
  useEffect(()=>{
    const projectId=new URLSearchParams(window.location.search).get('projectId');
    if(handoff.current||!projectId||!/^[a-f0-9-]{36}$/.test(projectId))return;
    handoff.current=true;
    void (async()=>{try{
      const project=await portalRequest<PortalProject>(`projects/${projectId}`);
      if(!['PLANNED','ACTIVE','ON_HOLD'].includes(project.status))throw new Error('This project cannot receive a new quote.');
      const clients=await portalRequest<{id:string;companyName:string}[]>('clients');
      const customer=clients.find(c=>c.id===project.clientId);if(!customer)throw new Error('The project customer is unavailable.');
      const q=makeQuote('contracting',loaded.data.pricing);
      const addr=project.siteAddress??{};
      q.answers={customer:customer.companyName,title:project.name,address:addr.formatted??[addr.line1,addr.city,addr.state,addr.zip].filter(Boolean).join(', '),description:project.description??''};
      q.portal={clientId:project.clientId,customerName:customer.companyName,projectId:project.id};
      setData(d=>({...d,quotes:[q,...d.quotes]}));setActiveId(q.id);
      window.history.replaceState(null,'',window.location.pathname);
    }catch(e){setStorageError(`Project handoff: ${(e as Error).message}`);}})();
  },[loaded.data.pricing]);
  useEffect(()=>{if(pristine.current){pristine.current=false;return;}if(loaded.error)return;try{save(data);setStorageError('');}catch{setStorageError('Device storage is unavailable or full. Export a backup before leaving.');}},[data,loaded.error]);
  useEffect(()=>()=>controller.current?.abort(),[]);
  const quote=data.quotes.find(q=>q.id===activeId);
  const refreshHistory=(id:string)=>{const h=loadQuoteHistory(id);setHistoryState(h);setHistoryError(h.error);};  useEffect(()=>{if(activeId)refreshHistory(activeId);},[activeId]);
  const update=(patch:Partial<Quote>,approval=false)=>setData(current=>({...current,quotes:current.quotes.map(q=>q.id!==activeId?q:{...q,...patch,updatedAt:new Date().toISOString(),approvedAt:approval?patch.approvedAt:undefined,acknowledged:approval?q.acknowledged:patch.acknowledged??false})}));
  const cancel=()=>{controller.current?.abort();controller.current=null;setBusy(false);setError('');};
  const home=()=>{cancel();setActiveId(null);setSettings(false);setImportOpen(false);window.scrollTo({top:0});};
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
  const captureSnapshot=(_snapshot:QuoteSnapshot,updated:QuoteSnapshot[]):string=>{const err=mergeQuoteHistory(_snapshot.quoteId,updated);if(err){setHistoryError(err);return err;}setHistoryState({snapshots:updated,error:''});setHistoryError('');return '';};
  const restoreFromSnapshot=(snapshot:QuoteSnapshot)=>{const restored=restoreSnapshot(snapshot);setData(d=>({...d,quotes:[restored,...d.quotes]}));refreshHistory(restored.id);setActiveId(restored.id);window.scrollTo({top:0});};
  const voiceStart=(type:JobType,address:string):Quote=>{const q=makeQuote(type,data.pricing);q.answers={address};setData(d=>({...d,quotes:[q,...d.quotes]}));setActiveId(q.id);window.scrollTo({top:0});return q;};
  const applyImported=(next:SavedState)=>{setData(next);setImportOpen(false);window.scrollTo({top:0});};
  return <><Header home={home} settings={()=>{cancel();setSettings(true);}} saved={!storageError}/>{storageError&&<div role="alert" className="storage-warning">{storageError}</div>}{historyError&&<div role="alert" className="storage-warning">Version history: {historyError}</div>}
    {(busy||error)&&quote?<Generating error={error} retry={()=>void research(true)} cancel={cancel}/>:settings?<Settings pricing={data.pricing} change={pricing=>setData(d=>({...d,pricing}))} back={()=>setSettings(false)} backup={()=>download(`revive-quotes-backup-${new Date().toISOString().slice(0,10)}.json`,JSON.stringify(data,null,2))}/>:quote?quote.stage==='guide'?<Guide quote={quote} update={update} exit={home} connections={()=>setSettings(true)} finish={()=>void research()}/>:quote.stage==='pricing'?<Estimate quote={quote} update={update} regenerate={()=>void research(true)} back={()=>{update({stage:'guide',step:Math.min(quote.step,questions(quote.type,quote.answers).length-1)});window.scrollTo({top:0});}} next={()=>navigate('review')}/>:<Review quote={quote} update={update} edit={stage=>{update({stage,...(stage==='guide'?{step:0}:{})});window.scrollTo({top:0});}} home={home} remove={()=>{setData(d=>({...d,quotes:d.quotes.filter(q=>q.id!==activeId)}));home();}} historySnapshots={historyState.snapshots} onCaptureSnapshot={captureSnapshot} onRestoreSnapshot={restoreFromSnapshot}/>:<Home quotes={data.quotes} start={start} resume={id=>{setActiveId(id);window.scrollTo({top:0});}} settings={()=>setSettings(true)} openImport={()=>setImportOpen(true)}/>}<VoicePanel quote={quote??null} update={update} research={research} busy={busy} error={error} startVoiceQuote={voiceStart}/>{importOpen&&<DraftImport current={data} onImported={applyImported} onClose={()=>setImportOpen(false)}/>}</>;
}
