import {answerText,jobNames,money,questions,totals,validAnswer,issues} from './domain';
import type {Quote,Question,JobType,Answers} from './domain';
import {approvalFingerprint,prepareApproval} from './portal';

export type VoicePhase='idle'|'mic-request'|'connecting'|'listening'|'speaking'|'thinking'|'paused'|'ended'|'mic-denied'|'disconnected'|'error';

const clean=(value:string)=>value.replace(/\s+/g,' ').trim();

export function parseNumber(value:string):number|null{
  const text=clean(value).replace(/,|\$/g,'');
  const fraction=text.match(/^(\d+(?:\.\d+)?)\s*\/\s*12$/);
  if(fraction)return Number(fraction[1]);
  const match=text.match(/-?\d+(?:\.\d+)?/);
  if(!match)return null;
  const n=Number(match[0]);
  return Number.isFinite(n)?n:null;
}

export function matchChoice(value:string,options:string[]):string|null{
  const normalize=(s:string)=>clean(s).toLowerCase().replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ');
  const target=normalize(value);
  if(!target)return null;
  let best:string|null=null;
  for(const option of options){
    const candidate=normalize(option);
    if(candidate===target)return option;
    if(!best&&(candidate.includes(target)||target.includes(candidate)))best=option;
  }
  return best;
}

export type Verdict={ok:boolean;error?:string;value?:string|string[]};
export function findQuestion(quote:Quote,field:string):Question|null{return questions(quote.type,quote.answers).find(q=>q.id===field)||null;}

export function evaluateSetAnswer(quote:Quote,field:string,value:unknown):Verdict{
  const question=findQuestion(quote,field);
  if(!question)return {ok:false,error:`"${field}" is not a question of this quote. Ask the next question from the app context.`};
  if(typeof value!=='string'||!clean(value))return {ok:false,error:'The answer was empty. Ask the question again.'};
  const text=clean(value);
  if(question.type==='multi')return {ok:false,error:'Use set_answer_options for this multi-select question.'};
  if(question.type==='choice'){
    const option=matchChoice(text,question.options||[]);
    if(!option)return {ok:false,error:`"${text}" did not match an option. The options are: ${(question.options||[]).join(', ')}. Please clarify.`};
    return {ok:true,value:option};
  }
  if(question.type==='number'){
    const n=parseNumber(text);
    if(n===null)return {ok:false,error:'No usable number was understood. Ask for the number again.'};
    const serial=String(n);
    if(!validAnswer(question,serial))return {ok:false,error:`${serial} is not a valid ${question.unit||'value'} for this question. Ask for a corrected value.`};
    return {ok:true,value:serial};
  }
  return {ok:true,value:text};
}

export function evaluateSetAnswerOptions(quote:Quote,field:string,values:unknown):Verdict{
  const question=findQuestion(quote,field);
  if(!question)return {ok:false,error:`"${field}" is not a question of this quote. Ask the next question from the app context.`};
  if(question.type!=='multi')return {ok:false,error:'This question takes a single answer. Use set_answer.'};
  if(!Array.isArray(values)||!values.length||values.some(v=>typeof v!=='string'))return {ok:false,error:'No options were selected. Ask which items apply.'};
  const matched:string[]=[];
  for(const value of values){const option=matchChoice(String(value),question.options||[]);if(!option)return {ok:false,error:`"${String(value)}" did not match an option. The options are: ${(question.options||[]).join(', ')}.`};if(!matched.includes(option))matched.push(option);}
  return {ok:true,value:matched};
}

export function evaluateMarkUnknown(quote:Quote,field:string):Verdict{
  const question=findQuestion(quote,field);
  if(!question)return {ok:false,error:`"${field}" is not a question of this quote.`};
  if(!question.unknown&&!question.optional)return {ok:false,error:'This answer is required for the quote. Briefly explain why it is needed and ask again.'};
  return {ok:true,value:question.unknown?'Not sure yet':''};
}

export function isMissing(question:Question,answers:Answers):boolean{
  return !question.optional&&!validAnswer(question,answers[question.id])||answers[question.id]==='Not sure yet';
}
export function nextQuestion(quote:Quote):Question|null{
  if(quote.stage!=='guide')return null;
  return questions(quote.type,quote.answers).find(q=>isMissing(q,quote.answers))||null;
}

export function answerValue(answers:Answers,field:string):string{
  const value=answers[field];
  if(Array.isArray(value))return value.join(', ');
  return typeof value==='string'?value:'';
}

export function voiceReadBack(quote:Quote):string{
  const t=totals(quote.lines,quote.pricing);
  const unresolved=issues(quote).filter(i=>!i.startsWith('AI follow-up:'));
  const parts=[
    `Job: ${answerText(quote.answers,'title')||'Untitled job'} — ${jobNames[quote.type]} for ${answerText(quote.answers,'customer')||'the customer on file'} at ${answerText(quote.answers,'address')||'the address on file'}.`,
    `Total: ${money(t.total)} (direct costs ${money(t.direct)}, markup ${quote.pricing.markup}%, contingency ${quote.pricing.contingency}%, tax ${quote.pricing.tax}%).`,
  ];
  const assumptions=quote.assumptions.trim();
  parts.push(assumptions?`Material and pricing assumptions: ${assumptions.split('\n').filter(Boolean).join('; ')}.`:'No material assumptions were recorded.');
  const exclusions=quote.exclusions.trim();
  if(exclusions)parts.push(`Exclusions: ${exclusions.split('\n').filter(Boolean).join('; ')}.`);
  parts.push(unresolved.length?`Flagged for review: ${unresolved.join('; ')}.`:'Nothing is flagged for review.');
  parts.push('Saving creates an approved revision, stores the estimate PDF and creates a pending project in the portal. The customer is not contacted and acceptance stays a separate portal action. Do you confirm saving exactly this revision?');
  return parts.join(' ');
}

export type ApprovalGate={ok:boolean;reason?:string};
export function approvalBlockers(quote:Quote):string[]{
  const blockers:string[]=[];
  if(quote.approvedAt)blockers.push('This revision is already approved.');
  if(!quote.lines.length)blockers.push('The estimate has no priced lines yet.');
  if(quote.lines.some(l=>!l.description.trim()||!Number.isFinite(l.quantity)||l.quantity<=0||[l.material,l.hours,l.rate].some(n=>!Number.isFinite(n)||n<0)||l.quantity*l.material+l.hours*l.rate<=0||(l.hours>0&&l.rate<=0)))blockers.push('Some cost lines still need quantities or pricing.');
  if(quote.kind==='fixed'&&issues(quote).length)blockers.push('A fixed quote still has flagged items to resolve.');
  if(!quote.portal?.clientId)blockers.push('No portal customer is selected. Choose the matching customer on screen.');
  return blockers;
}

export type PreparedApproval={readback:string;fingerprint:string;approvalId:string};
export function prepareVoiceApproval(quote:Quote):PreparedApproval{
  const prepared=prepareApproval(quote);
  return {readback:voiceReadBack(quote),fingerprint:prepared.fingerprint,approvalId:prepared.approvalId};
}
export function confirmVoiceApproval(quote:Quote,pending:PreparedApproval|null,statedFingerprint:string):ApprovalGate{
  if(!pending)return {ok:false,reason:'No revision was read back yet. Call prepare_approval first.'};
  if(statedFingerprint!==pending.fingerprint)return {ok:false,reason:'That confirmation does not match the revision that was read back. Read the summary again and confirm this exact revision.'};
  if(pending.fingerprint!==approvalFingerprint(quote))return {ok:false,reason:'The quote changed after the summary was read. A new read-back is required before saving.'};
  const blockers=approvalBlockers(quote);
  if(blockers.length)return {ok:false,reason:blockers[0]};
  return {ok:true};
}

export type VoiceContextInput={userName?:string;quote:Quote|null;user?:{id?:string;userId?:string;email?:string}};
export function buildVoiceContext({userName,quote}:VoiceContextInput):string{
  const lines=[];
  lines.push(`Signed-in user: ${userName||'Revive staff member'}.`);
  if(!quote){
    lines.push('No quote is open yet. Greet the user by name, then ask what they are quoting (roofing, commercial renovation, or general contracting) and where the work is. Use start_quote once both are clear. If they only give the address first, infer the job type from their wording or ask.');
  }else{
    lines.push(`Open quote: ${jobNames[quote.type]} (ref ${quote.id.slice(0,8)}), stage ${quote.stage}, kind ${quote.kind}.`);
    const keys=Object.keys(quote.answers);
    if(keys.length)lines.push(`Answers already provided (do not ask for these again): ${JSON.stringify(quote.answers)}`);
    if(quote.lines.length)lines.push(`Current estimate total: ${money(totals(quote.lines,quote.pricing).total)} over ${quote.lines.length} cost lines.`);
    if(quote.stage==='guide'){
      const next=nextQuestion(quote);
      if(next)lines.push(`The next question to ask aloud: ${JSON.stringify({id:next.id,title:next.title,options:next.options,unit:next.unit,multi:next.type==='multi',unknownAllowed:!!next.unknown,optional:!!next.optional})}. Ask it in your own words.`);
      else lines.push('All intake questions are answered. Offer to build the researched estimate with start_estimate.');
    }else if(quote.stage==='pricing')lines.push('The researched estimate is ready. Walk through scope, price and assumptions when asked; edits happen on screen. Use prepare_approval when the user wants to review for approval.');
    else lines.push('The estimate is under review. Use prepare_approval before any save. The portal customer and acknowledgment must be recorded on screen if missing; tell the user instead of saving.');
  }
  return lines.join(' ');
}

export type ToolResult={ok:boolean;message:string};
export type VoiceActions={
  getQuote():Quote|null;
  getUserName():string;
  startQuote(type:JobType,address:string):{message:string;quote:Quote|null};
  setAnswer(field:string,value:string|string[]):{message:string;quote:Quote|null};
  markUnknown(field:string):{message:string;quote:Quote|null};
  goBack(field:string):{message:string;quote:Quote|null};
  measureRoof(address:string):Promise<{message:string;quote:Quote|null}>;
  startEstimate():{message:string;quote:Quote|null};
  saveApproval(quote:Quote):Promise<{saved:boolean;message:string;quote:Quote|null}>;
};
export type TranscriptEntry={role:'revive'|'user'|'status';text:string};
export type VoiceState={phase:VoicePhase;paused:boolean;transcript:TranscriptEntry[];pendingApproval:PreparedApproval|null;error:string};

const toolResult=(call:{call_id:string;name:string},result:ToolResult)=>({type:'conversation.item.create',item:{type:'function_call_output',call_id:call.call_id,output:JSON.stringify(result)}});

export function createVoiceController(actions:VoiceActions,{onState}:{onState:(state:VoiceState)=>void},send:(event:unknown)=>void){
  let state:VoiceState={phase:'connecting',paused:false,transcript:[],pendingApproval:null,error:''};
  let currentResponseId='';
  let interrupting=false;
  let assistantSpoken='';
  // Realtime can deliver the same function call via response.output_item.done AND
  // response.done; only the first delivery of a call_id is executed. The set is
  // cleared on each new response so it cannot grow across a session.
  let handledCallIds=new Set<string>();
  // The quote as of the most recent applied tool call. Actions return the updated
  // quote synchronously so the next context push never re-reads a stale ref.
  let activeQuote:Quote|null=null;
  const emit=()=>onState(state);
  const update=(patch:Partial<VoiceState>)=>{state={...state,...patch};emit();};
  const note=(role:TranscriptEntry['role'],text:string)=>update({transcript:[...state.transcript.slice(-60),{role,text}]});
  const pushContext=(quoteOverride?:Quote|null,instructions?:string)=>{
    const quote=quoteOverride===undefined?actions.getQuote():quoteOverride;
    send({type:'conversation.item.create',item:{type:'message',role:'system',content:[{type:'input_text',text:buildVoiceContext({userName:actions.getUserName(),quote})}]}});
    send({type:'response.create',response:instructions?{instructions}:{context:null}});
  };
  // Answers recorded since the last spoken recap. After every fourth, the tool
  // result tells Revive to recap them and confirm before continuing.
  let sinceRecap:{field:string;value:string|string[]}[]=[];
  const recapSuffix=():string=>{
    if(sinceRecap.length<4)return '';
    const listed=sinceRecap.slice(-4).map(e=>{
      const title=findQuestion((actions.getQuote()||activeQuote)!,e.field)?.title||e.field;
      const value=Array.isArray(e.value)?e.value.join(' and '):e.value;
      return `${title}: ${value}`;
    }).join('; ');
    sinceRecap=[];
    return ` RECAP-DUE: In one sentence, confirm these four answers with the user before the next question — ${listed}.`;
  };
  const dispatchTool=async(call:{call_id:string;name:string;arguments:string}):Promise<ToolResult>=>{
    let args:Record<string,unknown>={};
    try{args=call.arguments?JSON.parse(call.arguments):{};}catch{return {ok:false,message:'The command was malformed and was ignored. Continue the conversation.'};}
    if(state.paused&&call.name!=='resume_session')return {ok:false,message:'The session is paused. Do not act; wait for the user to resume.'};
    const quote=actions.getQuote()??activeQuote;
    switch(call.name){
      case 'start_quote':{
        const type=args.type as JobType,address=typeof args.address==='string'?clean(args.address):'';
        if(!['roofing','renovation','contracting'].includes(type))return {ok:false,message:'Unknown job type. Ask roofing, commercial renovation, or general contracting.'};
        if(!address)return {ok:false,message:'No address was given. Ask where the work is.'};
        if(quote)return {ok:false,message:`A quote (${quote.id.slice(0,8)}) is already open. Continue it or end this quote first.`};
        const applied=actions.startQuote(type,address);activeQuote=applied.quote;
        return {ok:true,message:applied.message};
      }
      case 'set_answer':{
        if(!quote)return {ok:false,message:'No quote is open yet. Ask for the job type and address and use start_quote.'};
        const verdict=evaluateSetAnswer(quote,String(args.field||''),args.value);
        if(!verdict.ok||verdict.value===undefined)return {ok:false,message:verdict.error||'The answer could not be recorded. Ask again.'};
        const applied=actions.setAnswer(String(args.field),verdict.value as string);activeQuote=applied.quote??quote;
        sinceRecap.push({field:String(args.field),value:verdict.value as string});
        return {ok:true,message:applied.message+recapSuffix()};
      }
      case 'set_answer_options':{
        if(!quote)return {ok:false,message:'No quote is open yet.'};
        const verdict=evaluateSetAnswerOptions(quote,String(args.field||''),args.values);
        if(!verdict.ok||verdict.value===undefined)return {ok:false,message:verdict.error||'The answer could not be recorded. Ask again.'};
        const applied=actions.setAnswer(String(args.field),verdict.value as string[]);activeQuote=applied.quote??quote;
        sinceRecap.push({field:String(args.field),value:verdict.value as string[]});
        return {ok:true,message:applied.message+recapSuffix()};
      }
      case 'mark_unknown':{
        if(!quote)return {ok:false,message:'No quote is open yet.'};
        const verdict=evaluateMarkUnknown(quote,String(args.field||''));
        if(!verdict.ok||verdict.value===undefined)return {ok:false,message:verdict.error||'The answer could not be recorded. Ask again.'};
        const applied=actions.markUnknown(String(args.field));activeQuote=applied.quote??quote;
        sinceRecap.push({field:String(args.field),value:verdict.value as string});
        return {ok:true,message:applied.message+recapSuffix()};
      }
      case 'measure_roof':{
        if(!quote)return {ok:false,message:'No quote is open yet. Ask for the job type and address and use start_quote.'};
        if(quote.type!=='roofing')return {ok:false,message:'Google roof measurement is only available for roofing quotes.'};
        const requested=typeof args.address==='string'?clean(args.address):'';
        const target=requested||clean(answerText(quote.answers,'address'));
        if(!target)return {ok:false,message:'No address was given. Ask where the work is, then measure.'};
        if(answerText(quote.answers,'roofArea'))return {ok:true,message:`A roof area of ${answerText(quote.answers,'roofArea')} sq ft is already recorded. Ask the user whether to keep it or measure again with Google.`};
        const measured=await actions.measureRoof(target);
        activeQuote=measured.quote??quote;
        return {ok:true,message:measured.message};
      }
      case 'go_back':{
        if(!quote)return {ok:false,message:'No quote is open yet.'};
        const field=String(args.field||'');
        if(!findQuestion(quote,field))return {ok:false,message:'That question is not part of this quote. Ask the current question again.'};
        const applied=actions.goBack(field);activeQuote=applied.quote;
        return {ok:true,message:applied.message};
      }
      case 'pause_session':update({paused:true,phase:'paused'});note('status','Paused.');return {ok:true,message:'Paused. The user can resume by voice or screen.'};
      case 'resume_session':update({paused:false,phase:'listening'});note('status','Resumed.');return {ok:true,message:'Resumed. Continue with the next question.'};
      case 'start_estimate':{
        if(!quote)return {ok:false,message:'No quote is open yet.'};
        if(quote.stage!=='guide')return {ok:false,message:'The estimate is already built. Review it on screen or use prepare_approval.'};
        const missing=questions(quote.type,quote.answers).filter(q=>isMissing(q,quote.answers));
        if(missing.length)return {ok:false,message:`The intake is incomplete. Ask next: ${missing[0].title}`};
        const applied=actions.startEstimate();activeQuote=applied.quote??quote;
        return {ok:true,message:applied.message};
      }
      case 'prepare_approval':{
        if(!quote)return {ok:false,message:'No quote is open yet.'};
        if(quote.stage!=='review')return {ok:false,message:'The researched estimate is not ready. Finish the intake and start the estimate first.'};
        const prepared=prepareVoiceApproval(quote);
        update({pendingApproval:prepared});
        return {ok:true,message:`Read the following summary aloud verbatim, then ask the user to explicitly confirm saving this exact revision. SUMMARY: ${prepared.readback}`};
      }
      case 'confirm_approval':{
        if(!quote)return {ok:false,message:'No quote is open yet.'};
        const gate=confirmVoiceApproval(quote,state.pendingApproval,String(args.fingerprint||''));
        if(!gate.ok)return {ok:false,message:`Not saved. ${gate.reason} Do not retry on your own; wait for the user.`};
        const result=await actions.saveApproval(quote);
        activeQuote=result.quote??quote;
        update({pendingApproval:null});
        return {ok:result.saved,message:result.message};
      }
      case 'end_session':update({phase:'ended'});note('status','Session ended.');return {ok:true,message:'Session ended. The user can keep editing on screen.'};
      default:return {ok:false,message:'Unknown command; ignored.'};
    }
  };
  const finishTools=async(calls:{call_id:string;name:string;arguments:string}[])=>{
    const fresh=calls.filter(call=>{
      if(handledCallIds.has(call.call_id))return false;
      handledCallIds.add(call.call_id);
      return true;
    });
    for(const call of fresh){
      note('status',`Command: ${call.name}`);
      const result=await dispatchTool(call);
      send(toolResult(call,result));
    }
    if(state.phase!=='ended'&&state.phase!=='paused')pushContext(activeQuote??undefined);
  };
  const handleEvent=(event:Record<string,unknown>)=>{
    const type=String(event.type||'');
    if(type==='session.created'){update({phase:'listening'});pushContext(undefined,'Greet the user by name, then follow the app context. Keep it to one or two spoken sentences.');return;}
    if(type==='response.created'){currentResponseId=String((event.response as {id?:string})?.id||'');interrupting=false;handledCallIds.clear();update({phase:state.paused?'paused':'speaking'});return;}
    if(type==='input_audio_buffer.speech_started'){interrupting=currentResponseId!=='';update({phase:'listening'});return;}
    if(type==='input_audio_buffer.committed'){if(!state.paused)update({phase:'thinking'});return;}
    if(type==='conversation.item.input_audio_transcription.completed'){const transcript=typeof event.transcript==='string'?event.transcript:'';if(transcript.trim())note('user',transcript);return;}
    if(type==='response.output_audio_transcript.delta'){
      if(interrupting)return;
      if(typeof event.delta==='string'&&event.delta)assistantSpoken+=event.delta;
      return;
    }
    if(type==='response.output_audio_transcript.done'){
      if(interrupting){assistantSpoken='';return;}
      const text=typeof event.transcript==='string'&&event.transcript?event.transcript:assistantSpoken;
      if(text.trim())note('revive',text.trim());
      assistantSpoken='';
      return;
    }
    if(type==='response.output_item.done'){
      const item=event.item as {type?:string;call_id?:string;name?:string;arguments?:string}|undefined;
      if(item?.type==='function_call'&&item.call_id)void finishTools([{call_id:item.call_id,name:String(item.name||''),arguments:String(item.arguments||'')}]);
      return;
    }
    if(type==='response.done'){
      const response=event.response as {output?:{type?:string;call_id?:string;name?:string;arguments?:string}[];id?:string}|undefined;
      const calls=(response?.output||[]).filter(item=>item.type==='function_call'&&item.call_id).map(item=>({call_id:item.call_id!,name:String(item.name||''),arguments:String(item.arguments||'')}));
      if(calls.length)void finishTools(calls);
      else if(!state.paused)update({phase:'listening'});
      return;
    }
    if(type==='error'){
      const message=typeof (event.error as {message?:string})?.message==='string'?(event.error as {message:string}).message:'Voice error';
      note('status',message);
      if(/session|expired|invalid/i.test(message)&&!/too short|buffer/i.test(message))update({phase:'disconnected',error:message});
      return;
    }
  };
  const setPaused=(paused:boolean)=>{
    if(paused===state.paused)return;
    update({paused,phase:paused?'paused':'listening'});
    if(!paused)pushContext(undefined,'The user resumed the session. Continue with the next question from the app context.');
  };
  const notify=(text:string)=>{if(state.phase==='ended')return;pushContext(undefined,`APP UPDATE: ${text} Respond briefly.`);};
  return {handleEvent,notify,setPaused,get state(){return state;}};
}

