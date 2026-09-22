import {createHash} from 'node:crypto';
// Voice sessions use the OpenAI Realtime API directly over WebRTC.
// Headroom (the shared OpenAI-compatible proxy) serves chat/responses HTTP and
// returned HTTP 404 for POST /v1/realtime/client_secrets when probed on
// 2026-09-21, so it cannot mint ephemeral tokens or carry a WebRTC media
// path. Estimate/research calls keep their existing Headroom routing; only
// this module talks to the realtime endpoint directly, with the same
// server-side key that is already configured for estimates.
const REALTIME_BASE='https://api.openai.com/v1';
const reply=(res,status,value)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));};

export const voiceTools=[
  {type:'function',name:'start_quote',description:'Create a new quote draft once the job type and address are clear from the conversation. Only call this when both are known; otherwise ask for the missing one.',parameters:{type:'object',properties:{type:{type:'string',enum:['roofing','renovation','contracting'],description:'The job type the user asked for.'},address:{type:'string',description:'The full job address including city and ZIP, exactly as the user said it.'}},required:['type','address'],additionalProperties:false}},
  {type:'function',name:'set_answer',description:'Record a confirmed answer for the current intake question. Confirm numbers, measurements and addresses with the user before calling.',parameters:{type:'object',properties:{field:{type:'string',description:'The question id from the app context.'},value:{type:'string',description:'The confirmed answer.'}},required:['field','value'],additionalProperties:false}},
  {type:'function',name:'set_answer_options',description:'Record the selected options for a multi-choice question after the user confirms the complete selection.',parameters:{type:'object',properties:{field:{type:'string',description:'The question id from the app context.'},values:{type:'array',items:{type:'string'},description:'Every selected option, matching the context options exactly.'}},required:['field','values'],additionalProperties:false}},
  {type:'function',name:'mark_unknown',description:'Record that the user does not know the answer. Only valid for questions the context marks with unknownAllowed or optional; otherwise explain why an answer is needed.',parameters:{type:'object',properties:{field:{type:'string',description:'The question id from the app context.'}},required:['field'],additionalProperties:false}},
  {type:'function',name:'measure_roof',description:'Measure the roof for this job using Google aerial imagery (roofing quotes only). Use it when the roof area question comes up and the user does not already have a trusted measurement. Read the result aloud, state any partial-coverage warning, and get the user to confirm the matched building and that the quoted sections are included before recording roofArea.',parameters:{type:'object',properties:{address:{type:'string',description:'The job address to measure. Omit to use the address already recorded on the quote.'}},required:[],additionalProperties:false}},
  {type:'function',name:'go_back',description:'Move the conversation back to a previously answered question so the user can correct it.',parameters:{type:'object',properties:{field:{type:'string',description:'The question id to revisit.'}},required:['field'],additionalProperties:false}},
  {type:'function',name:'pause_session',description:'Pause the session. The microphone stays on; ignore small talk while paused and only act on a request to resume.',parameters:{type:'object',properties:{},required:[],additionalProperties:false}},
  {type:'function',name:'resume_session',description:'Resume a paused session.',parameters:{type:'object',properties:{},required:[],additionalProperties:false}},
  {type:'function',name:'start_estimate',description:'The user asked to build the researched estimate with the current answers. The app will confirm before replacing an existing researched estimate.',parameters:{type:'object',properties:{},required:[],additionalProperties:false}},
  {type:'function',name:'prepare_approval',description:'The user asked to review and approve the estimate. The app returns the exact read-back text; read it aloud verbatim and ask for explicit confirmation of that revision.',parameters:{type:'object',properties:{},required:[],additionalProperties:false}},
  {type:'function',name:'confirm_approval',description:'The user explicitly confirmed the exact revision you read back. Requires the revision fingerprint returned by the last prepare_approval result.',parameters:{type:'object',properties:{fingerprint:{type:'string',description:'The revision fingerprint from the prepare_approval result.'}},required:['fingerprint'],additionalProperties:false}},
  {type:'function',name:'end_session',description:'The user is done talking. End the voice session; typed editing stays available.',parameters:{type:'object',properties:{},required:[],additionalProperties:false}},
];

export function coreInstructions(){
  return [
    'You are Revive, the voice estimating assistant of the Revive Repair Co. Quote Assistant. You speak with an authenticated Revive staff member preparing a real quote.',
    'Rules you never break: never invent prices, measurements, addresses or scope; never claim anything was saved, sent, purchased or accepted; never ask for or repeat the user\'s password; never contact anyone; prices and totals come only from the app context and tool results.',
        'Conversation style: warm, brief, spoken sentences. Ask exactly one question at a time, in the order the app context gives you. Wait for the answer. Do not ask the user to confirm every answer — record plain text scope answers directly via set_answer as soon as they are clear. Only repeat back and confirm numbers, measurements, quantities and addresses before recording them, then record. If the user corrects you, accept the correction without arguing. For the roof area question on a roofing quote, offer to measure with Google (measure_roof) before asking the user for a number. After every fourth recorded answer, briefly recap those four answers in one spoken sentence and ask the user to confirm everything is right before moving on; the tool result tells you when that recap is due and lists the answers.',
    'When the user says repeat that, say it again without calling tools. When they say go back or want to change an earlier answer, call go_back. When they say pause, call pause_session; while paused, only respond to requests to resume by calling resume_session. When they say I don\'t know, call mark_unknown if the question allows it, otherwise briefly explain why the quote needs an answer and offer options. When they ask to build the estimate, call start_estimate. When they want to review or approve, call prepare_approval first, read the returned summary verbatim, and wait for an explicit yes before calling confirm_approval with the fingerprint from that result. When the save succeeds, announce the portal revision and pending project from the tool result. When they are done, call end_session.',
    'The app sends you context items describing the signed-in user, the current quote and the next question to ask. Follow the latest context item; it overrides older ones. The tool results tell you what happened; state them honestly. If a tool result reports an error, say what went wrong in plain language and do not retry the same call on your own.',
  ].join(' ');
}

export function buildSessionConfig({model,voice,context}){
  const instructions=[coreInstructions(),context?`APP CONTEXT:\n${context}`:''].filter(Boolean).join('\n\n');
  return {session:{type:'realtime',model,instructions,tools:voiceTools,tool_choice:'auto',audio:{output:{voice},input:{turn_detection:{type:'semantic_vad',eagerness:'low',create_response:true,interrupt_response:true}}}}};
}

export function createVoiceHandler({env=process.env,fetcher=fetch,authenticate,origins}){
  const model=env.OPENAI_REALTIME_MODEL||'gpt-realtime-2.1';
  const voice=env.OPENAI_REALTIME_VOICE||'marin';
  const base=(env.OPENAI_REALTIME_BASE_URL||REALTIME_BASE).replace(/\/$/,'');
  const windows=new Map();
  return async function handler(req,res){
    if(req.url!=='/api/voice/session'||req.method!=='POST')return false;
    if(!origins.has(req.headers.origin))return reply(res,403,{error:'Request origin not allowed.'});
    if(!req.headers['content-type']?.startsWith('application/json'))return reply(res,415,{error:'Use application/json.'});
    let identity=req.socket.remoteAddress;
    if(production(env)){const user=await authenticate(req);identity=user.userId||user.id||user.email;if(!identity)return reply(res,403,{error:'Your portal account is missing an identity.'});}
    if(!env.OPENAI_API_KEY)return reply(res,503,{error:'Voice is not configured on the server yet.'});
    const now=Date.now();for(const [id,times] of windows)if(times.every(t=>now-t>=3600000))windows.delete(id);
    const recent=(windows.get(identity)||[]).filter(t=>now-t<3600000);
    if(recent.length>=12)return reply(res,429,{error:'You have started many voice sessions this hour. Try again later.'});
    let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>50000)return reply(res,413,{error:'Voice request is too large.'});chunks.push(chunk);}
    let context='';try{const input=JSON.parse(Buffer.concat(chunks).toString()||'{}');if(typeof input.context==='string')context=input.context.slice(0,6000);}catch{return reply(res,400,{error:'Use a valid JSON request.'});}
    windows.set(identity,[...recent,now]);
    try{
      const response=await fetcher(`${base}/realtime/client_secrets`,{method:'POST',headers:{Authorization:`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json','OpenAI-Safety-Identifier':'revive-quote-assistant-'+createHash('sha256').update(String(identity)).digest('hex').slice(0,32)},body:JSON.stringify(buildSessionConfig({model,voice,context})),signal:AbortSignal.timeout(15000)});
      const data=await response.json().catch(()=>({}));
      if(!response.ok){
        const message=response.status===401?'The server API key was rejected for voice sessions.':response.status===403?'This API project does not have voice session access.':response.status===429?'The voice service is rate limited. Please try again shortly.':'Voice could not start right now. Please retry.';
        return reply(res,[401,403,429].includes(response.status)?response.status:502,{error:message});
      }
      if(typeof data.value!=='string'||!data.value)return reply(res,502,{error:'Voice session credentials were incomplete. Please retry.'});
      return reply(res,200,{clientSecret:data.value,model,voice,webRtcUrl:`${base.replace('/v1','')}/v1/realtime/calls`});
    }catch(error){
      if(error?.name==='TimeoutError')return reply(res,504,{error:'Voice took too long to start. Please retry.'});
      return reply(res,502,{error:'Voice could not start right now. Please retry.'});
    }
  };
}
const production=env=>env.NODE_ENV==='production';
