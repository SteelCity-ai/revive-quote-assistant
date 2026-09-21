import {useCallback,useEffect,useRef,useState} from 'react';
import {AlertTriangle, Mic, MicOff, Pause, Play, Send, Square, Volume2} from 'lucide-react';
import {questions} from './domain';
import type {Quote,JobType} from './domain';
import {portalRequest,prepareApproval} from './portal';
import type {PortalReceipt} from './portal';
import {createVoiceController,isMissing,nextQuestion} from './voice';
import type {VoicePhase,VoiceState} from './voice';

type Props={quote:Quote|null;update:(patch:Partial<Quote>,approval?:boolean)=>void;research:(force?:boolean)=>void;busy:boolean;error:string;startVoiceQuote:(type:JobType,address:string)=>Quote};
type SessionInfo={clientSecret:string;model:string;webRtcUrl:string};

const phaseLabel:Record<VoicePhase,string>={
  idle:'Ready', 'mic-request':'Asking for the microphone','connecting':'Connecting…',listening:'Listening…',speaking:'Revive is speaking…',thinking:'Thinking…',paused:'Paused',ended:'Ended','mic-denied':'Microphone blocked',disconnected:'Disconnected',error:'Voice error',
};
const active=(phase:VoicePhase)=>['mic-request','connecting','listening','speaking','thinking','paused'].includes(phase);

export default function VoicePanel({quote,update,research,busy,error,startVoiceQuote}:Props){
  const [available,setAvailable]=useState<boolean|null>(null);
  const [state,setState]=useState<VoiceState>({phase:'idle',paused:false,transcript:[],pendingApproval:null,error:''});
  const [muted,setMuted]=useState(false);
  const [typed,setTyped]=useState('');
  const [userName,setUserName]=useState('');
  const refs={pc:useRef<RTCPeerConnection|null>(null),dc:useRef<RTCDataChannel|null>(null),stream:useRef<MediaStream|null>(null),controller:useRef<ReturnType<typeof createVoiceController>|null>(null),quote:useRef(quote),update:useRef(update),research:useRef(research),startVoiceQuote:useRef(startVoiceQuote),busy:useRef(false)};
  refs.quote.current=quote;refs.update.current=update;refs.research.current=research;refs.startVoiceQuote.current=startVoiceQuote;
  useEffect(()=>{fetch('/api/app/config').then(r=>r.json()).then(c=>setAvailable(!!c.voiceAvailable)).catch(()=>setAvailable(false));},[]);
  useEffect(()=>{fetch('/api/portal/status').then(r=>r.json()).then(s=>setUserName(String(s.user?.displayName||''))).catch(()=>{});},[]);
  useEffect(()=>{ // report research completion back into the conversation
    const controller=refs.controller.current;if(!controller)return;
    if(busy&&!refs.busy.current)controller.notify('The researched estimate is being prepared now. Tell the user it takes about a minute and they can watch the screen.');
    if(!busy&&refs.busy.current)controller.notify(error?`The estimate generation failed: ${error} The quote answers are unchanged.`:'The researched estimate finished and is on the review screen. Summarize the result briefly and offer to review it aloud.');
    refs.busy.current=busy;
  },[busy,error]);

  const send=useCallback((event:unknown)=>{const dc=refs.dc.current;if(dc&&dc.readyState==='open')dc.send(JSON.stringify(event));},[]);
  const startQuote=useCallback((type:JobType,address:string)=>{
    const existing=refs.quote.current;
    if(existing)return {message:'A quote is already open.',quote:existing};
    const created=refs.startVoiceQuote.current(type,address);
    return {message:'The quote draft is created and saved on this device. Continue with the intake questions.',quote:created};
  },[]);
  const applyAnswer=useCallback((field:string,value:string|string[])=>{
    const current=refs.quote.current;if(!current)return null;
    const answers={...current.answers,[field]:value};
    const list=questions(current.type,answers);
    const next=list.find(q=>isMissing(q,answers));
    const nextIndex=next?list.findIndex(q=>q.id===next.id):list.length-1;
    const updated:Quote={...current,answers,step:Math.max(0,nextIndex)};
    refs.update.current({answers,step:Math.max(0,nextIndex)});
    return {message:`Recorded. ${next?`Next: ${next.title}`:'The intake is complete. Offer to build the researched estimate.'}`,quote:updated};
  },[]);
  const saveApproval=useCallback(async(current:Quote):Promise<{saved:boolean;message:string;quote:Quote|null}>=>{
    const prepared=prepareApproval(current);
    const pending={...(current.portal||{clientId:'',customerName:''}),approvalId:prepared.approvalId,fingerprint:prepared.fingerprint,error:undefined,receipt:undefined};
    refs.update.current({portal:pending,acknowledged:true});
    try{
      const receipt=await portalRequest<PortalReceipt>('quotes',prepared.body);
      refs.update.current({portal:{...pending,receipt},approvedAt:receipt.approvedAt,acknowledged:true},true);
      return {saved:true,message:`Saved to the portal as revision ${receipt.revision}. The estimate PDF is stored and a pending project was created. The customer has not been contacted; acceptance stays a separate portal step.`,quote:refs.quote.current};
    }catch(e){
      const message=(e as Error).message;
      refs.update.current({portal:{...pending,error:message}});
      return {saved:false,message:`The portal save failed: ${message} The draft is unchanged. You can retry on screen or by voice.`,quote:refs.quote.current};
    }
  },[]);
  const actions=useCallback(()=>({
    getQuote:()=>refs.quote.current,
    getUserName:()=>userName,
    startQuote,
    setAnswer:(field:string,value:string|string[])=>applyAnswer(field,value)??{message:'No quote is open. Ask for the job type and address and use start_quote.',quote:refs.quote.current},
    markUnknown:(field:string)=>applyAnswer(field,'Not sure yet')??{message:'No quote is open.',quote:refs.quote.current},
    goBack:(field:string)=>{
      const current=refs.quote.current;if(!current)return {message:'No quote is open.',quote:current};
      const list=questions(current.type,current.answers);
      const index=list.findIndex(q=>q.id===field);
      const updated:Quote={...current,step:Math.max(0,index)};
      refs.update.current({step:Math.max(0,index)});
      return {message:`Going back to: ${list[index]?.title||field}`,quote:updated};
    },
    startEstimate:()=>{refs.research.current();return {message:'The researched estimate is being prepared. It usually takes about a minute. I will tell you when it is done.',quote:refs.quote.current};},
    saveApproval,
  }),[userName,startQuote,applyAnswer,saveApproval]);

  const stop=useCallback((phase:VoicePhase)=>{
    refs.pc.current?.close();refs.pc.current=null;refs.dc.current=null;
    refs.stream.current?.getTracks().forEach(t=>t.stop());refs.stream.current=null;
    setState(s=>({...s,phase}));
  },[]);
  const start=useCallback(async()=>{
    setState(s=>({...s,phase:'mic-request',error:''}));
    let stream:MediaStream;
    try{stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});}
    catch{setState(s=>({...s,phase:'mic-denied'}));return;}
    refs.stream.current=stream;
    setState(s=>({...s,phase:'connecting'}));
    let session:SessionInfo;
    try{
      const response=await fetch('/api/voice/session',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      const data=await response.json().catch(()=>({error:'Voice could not start. Please retry.'}));
      if(!response.ok)throw new Error(data.error||'Voice could not start. Please retry.');
      session=data as SessionInfo;
    }catch(e){stream.getTracks().forEach(t=>t.stop());setState(s=>({...s,phase:'error',error:(e as Error).message}));return;}
    const pc=new RTCPeerConnection();
    refs.pc.current=pc;
    const controller=createVoiceController(actions(),{onState:setState},send);
    refs.controller.current=controller;
    const audio=new Audio();audio.autoplay=true;
    pc.ontrack=e=>{audio.srcObject=e.streams[0];void audio.play().catch(()=>{});};
    pc.onconnectionstatechange=()=>{
      if(['failed','disconnected','closed'].includes(pc.connectionState))setState(s=>active(s.phase)?{...s,phase:'disconnected'}:s);
    };
    const dc=pc.createDataChannel('oai-events');
    dc.onmessage=e=>{try{controller.handleEvent(JSON.parse(e.data));}catch{/* ignore malformed events */}};
    refs.dc.current=dc;
    try{
      pc.addTrack(stream.getAudioTracks()[0],stream);
      const offer=await pc.createOffer();
      await pc.setLocalDescription(offer);
      const sdpResponse=await fetch(session.webRtcUrl,{method:'POST',headers:{Authorization:`Bearer ${session.clientSecret}`,'Content-Type':'application/sdp'},body:offer.sdp||''});
      if(!sdpResponse.ok)throw new Error('Voice could not connect. Please retry.');
      await pc.setRemoteDescription({type:'answer',sdp:await sdpResponse.text()});
    }catch(e){stop('error');setState(s=>({...s,phase:'error',error:(e as Error).message}));}
  },[actions,send,stop]);
  const setMute=(next:boolean)=>{
    setMuted(next);
    refs.stream.current?.getAudioTracks().forEach(t=>{t.enabled=!next;});
  };
  const sendTyped=()=>{
    const text=typed.trim();if(!text)return;
    send({type:'conversation.item.create',item:{type:'message',role:'user',content:[{type:'input_text',text}]}});
    send({type:'response.create',response:{context:null}});
    setTyped('');
  };
  const current=quote?nextQuestion(quote):null;
  const phase=state.phase;
  if(available===false)return <p className="voice-unavailable">Voice needs the server AI key; it is not configured yet.</p>;
  if(phase==='idle')return <button className="voice-fab" onClick={()=>void start()}><Mic size={19}/><span>Talk to Revive</span></button>;
  return <div className="voice-overlay" role="dialog" aria-label="Voice conversation with Revive">
    <div className="voice-card">
      <header className="voice-head">
        <span className={`voice-status ${phase}`}><Volume2 size={15}/>{phaseLabel[phase]}{muted&&' · muted'}</span>
        <button className="icon-button" aria-label={muted?'Unmute microphone':'Mute microphone'} onClick={()=>setMute(!muted)}>{muted?<MicOff size={19}/>:<Mic size={19}/>}</button>
        <button className="icon-button" aria-label={state.paused?'Resume':'Pause'} onClick={()=>refs.controller.current?.setPaused(!state.paused)}>{state.paused?<Play size={19}/>:<Pause size={19}/>}</button>
        <button className="icon-button" aria-label="End voice session" onClick={()=>stop('ended')}><Square size={17}/></button>
      </header>
      {(phase==='mic-denied'||phase==='error'||phase==='disconnected')&&<div className="voice-problem" role="alert"><AlertTriangle size={18}/><div><strong>{phase==='mic-denied'?'Microphone access was blocked.':phase==='disconnected'?'The voice connection dropped.':'Voice could not start.'}</strong><p>{state.error||(phase==='mic-denied'?'Allow microphone access for this site in your browser settings, then tap retry.':'Your answers are saved on this device. Retry the voice session or continue on screen.')}</p><button className="primary" onClick={()=>void start()}>{phase==='mic-denied'?'Retry microphone':'Reconnect'}</button></div></div>}
      <div className="voice-now">{current?<div><small>Current question</small><p>{current.title}</p></div>:quote?.stage==='review'?<div><small>Ready to review</small><p>Ask Revive to read the estimate back, or review on screen.</p></div>:<div><small>Listening</small><p>{quote?'The intake is complete. Ask Revive to build the estimate.':'Tell Revive what you are quoting and where.'}</p></div>}</div>
      <div className="voice-transcript" aria-live="polite">
        {state.transcript.map((entry,i)=><p key={i} className={`voice-line ${entry.role}`}>{entry.text}</p>)}
      </div>
      <form className="voice-typed" onSubmit={e=>{e.preventDefault();sendTyped();}}>
        <input value={typed} onChange={e=>setTyped(e.target.value)} placeholder="Type instead — the conversation keeps going…" aria-label="Type a message to Revive"/>
        <button type="submit" className="icon-button" aria-label="Send typed message"><Send size={17}/></button>
      </form>
    </div>
  </div>;
}
