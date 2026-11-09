import http from 'node:http';
import os from 'node:os';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {inputSchema,generateEstimate} from './estimate.mjs';
import {createPortalHandler} from './portal.mjs';
import {createRoofMeasurer} from './roof.mjs';
import {createVoiceHandler} from './voice.mjs';
import {createTypeSafeHandler} from './typesafe.mjs';
import {clientAddress} from './identity.mjs';
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.woff2':'font/woff2','.ico':'image/x-icon'};
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
// Public instant-estimate lead capture. The consent text version travels with the
// stored contact details so a later audit can show exactly what the visitor agreed to.
export const CONSENT_TEXT_VERSION='2026-11-09-v1';
const INSTANT_CACHE_TTL_MS=6*60*60*1000;
const CONTACT_LIMITS={name:120,email:254,phone:40};
const EMAIL_PATTERN=/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const normalizeText=value=>String(value??'').trim().replace(/\s+/g,' ');
const writeInstantLead=async(env,record)=>{
  if(!env.LEADS_DIR)return;
  try{const {appendFile,mkdir}=await import('node:fs/promises');await mkdir(env.LEADS_DIR,{recursive:true}).catch(()=>{});await appendFile(resolve(env.LEADS_DIR,'instant.jsonl'),JSON.stringify(record)+'\n').catch(()=>{});}catch{}
};
const readContact=body=>{
  const source=body?.contact;
  if(source===undefined||source===null)return {name:'',email:'',phone:'',present:false};
  if(typeof source!=='object'||Array.isArray(source))return {error:'Contact details must be an object.'};
  const fields={};
  for(const [key,cap] of Object.entries(CONTACT_LIMITS)){
    const raw=source[key];
    if(raw===undefined||raw===null){fields[key]='';continue;}
    if(typeof raw!=='string')return {error:'Contact details must be text.'};
    const value=normalizeText(raw);
    if(value.length>cap)return {error:`${key[0].toUpperCase()+key.slice(1)} is too long (${cap} characters maximum).`};
    fields[key]=value;
  }
  if(fields.email&&!EMAIL_PATTERN.test(fields.email))return {error:'Enter a valid email address.'};
  if(fields.phone){const digits=fields.phone.replace(/\D/g,'');if(digits.length<7||digits.length>20)return {error:'Enter a valid phone number.'};}
  fields.email=fields.email.toLowerCase();
  return {...fields,present:Boolean(fields.name||fields.email||fields.phone)};
};
export function createApp({env=process.env,fetcher=fetch,generate=generateEstimate,staticDir=resolve('dist'),cacheTtlMs=INSTANT_CACHE_TTL_MS,now=Date.now}={}){
  const production=env.NODE_ENV==='production';
  if(production&&(!env.APP_ORIGIN||new URL(env.APP_ORIGIN).protocol!=='https:'||new URL(env.APP_ORIGIN).origin!==env.APP_ORIGIN))throw new Error('Production requires an exact HTTPS APP_ORIGIN.');
  const hosts=['localhost','127.0.0.1',...Object.values(os.networkInterfaces()).flat().filter(a=>a?.family==='IPv4').map(a=>a.address)];
  const origins=new Set(production?[env.APP_ORIGIN]:hosts.map(host=>`http://${host}:4178`));
  const trustProxy=env.TRUST_PROXY_HEADERS!=='false';
  const portal=createPortalHandler({baseUrl:env.PORTAL_API_URL||'https://portal.reviverepairco.com/api/v1',origins,fetcher,secureCookies:production,trustProxy});
  const measureRoof=createRoofMeasurer({fetcher,apiKey:env.GOOGLE_SOLAR_API_KEY||''});
  const roofWindows=new Map();
  const voice=createVoiceHandler({env,fetcher,authenticate:portal.authenticate,origins});
  const typesafe=createTypeSafeHandler({env,fetcher,authenticate:portal.authenticate,origins});
  // Per-purpose limit maps and independent concurrency slots (ADR 0001).
  const publicWindows=new Map(),adminWindows=new Map();
  const slots={public:false,admin:false};
  const globalCap=Number(env.GLOBAL_HOURLY_GENERATION_CAP||200);
  let globalTimes=[];
  const cacheTtl=Number.isFinite(cacheTtlMs)&&cacheTtlMs>0?cacheTtlMs:INSTANT_CACHE_TTL_MS;
  const clock=typeof now==='function'?now:Date.now;
  const instantCache=new Map();
  const cacheGet=key=>{const entry=instantCache.get(key);if(!entry)return null;if(entry.expiresAt<=clock()){instantCache.delete(key);return null;}return entry;};
  const cacheSet=(key,payload)=>{
    if(instantCache.size>=500){for(const [id,entry] of instantCache)if(entry.expiresAt<=clock())instantCache.delete(id);if(instantCache.size>=500)instantCache.delete(instantCache.keys().next().value);}
    instantCache.set(key,{payload,cachedAt:new Date(clock()).toISOString(),expiresAt:clock()+cacheTtl});
  };
  const prune=(map,now,windowMs)=>{for(const [id,times] of map)if(times.every(t=>now-t>=windowMs))map.delete(id);};
  const recent=(map,id,now,windowMs)=>(map.get(id)||[]).filter(t=>now-t<windowMs);
  const globalRecent=now=>{globalTimes=globalTimes.filter(t=>now-t<3600000);return globalTimes.length;};
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options','DENY');res.setHeader('Permissions-Policy','camera=(), microphone=(self), geolocation=()');
    if(production){res.setHeader('Strict-Transport-Security','max-age=31536000');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self' https://api.openai.com; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");}
    try{
      if(req.url==='/healthz'&&req.method==='GET')return json(res,200,{status:'ok',version:env.RELEASE_SHA||'development'});
      if(req.url==='/api/app/config'&&req.method==='GET')return json(res,200,{requiresLogin:production,voiceAvailable:!!env.OPENAI_API_KEY,roofMeasurementAvailable:!!env.GOOGLE_SOLAR_API_KEY,jevAvailable:!!env.TYPESAFE_API_KEY});
      if(await portal(req,res))return;
      if(await voice(req,res))return;
      if(await typesafe(req,res))return;
      if(req.url==='/api/roof/measure'&&req.method==='POST'){
        if(!origins.has(req.headers.origin))return json(res,403,{error:'Request origin not allowed.'});
        if(!req.headers['content-type']?.startsWith('application/json'))return json(res,415,{error:'Use application/json.'});
        let identity=clientAddress(req,{trustProxy});
        if(production){const user=await portal.authenticate(req);identity=user.userId||user.id||user.email;if(!identity)return json(res,403,{error:'Your portal account is missing an identity.'});}
        if(!measureRoof)return json(res,503,{error:'Roof measurement is not configured on the server.'});
        const now=Date.now();prune(roofWindows,now,3600000);
        const recentRoof=recent(roofWindows,identity,now,3600000);
        if(recentRoof.length>=30)return json(res,429,{error:'Too many measurement requests this hour. Please wait before retrying.'});
        let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>2000)return json(res,413,{error:'The address is too long.'});chunks.push(chunk);}
        let body;try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{return json(res,400,{error:'Invalid request.'});}
        if(typeof body.address!=='string'||!body.address.trim())return json(res,400,{error:'Enter the job address before requesting a measurement.'});
        roofWindows.set(identity,[...recentRoof,now]);
        const result=await measureRoof(body.address);
        if(!result.available)return json(res,422,result);
        return json(res,200,result);
      }
      if(req.url==='/api/ai/status'&&req.method==='GET')return json(res,200,{configured:!!env.OPENAI_API_KEY,model:env.OPENAI_ESTIMATE_MODEL||'gpt-5.4-mini-2026-03-17',researchModel:env.OPENAI_MODEL||'gpt-4.1',webResearch:true});
      if(req.url==='/api/instant/estimate'&&req.method==='POST'){
        // Public lead-gen endpoint (ponytail): no auth, tight rate limit, tiny payload.
        if(!env.OPENAI_API_KEY)return json(res,503,{error:'Instant estimates are not configured yet. Please call us for a quote.'});
        if(production&&!origins.has(req.headers.origin))return json(res,403,{error:'Request origin not allowed.'});
        if(!req.headers['content-type']?.startsWith('application/json'))return json(res,415,{error:'Use application/json.'});
        const now=Date.now();prune(publicWindows,now,3600000);
        const identity=clientAddress(req,{trustProxy});
        const seen=recent(publicWindows,identity,now,3600000);
        if(seen.length>=3)return json(res,429,{error:'Too many instant estimates from this address this hour. Please call us instead.'});
        let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>2000)return json(res,413,{error:'Request too large.'});chunks.push(chunk);}
        let body;try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{return json(res,400,{error:'Invalid request.'});}
        const contact=readContact(body);
        if(contact.error)return json(res,400,{error:contact.error});
        const consent=body.consent===true;
        // PII guard: contact details are accepted only together with explicit consent.
        if(contact.present&&!consent)return json(res,400,{error:'Contact details can only be stored with your permission. Tick the consent box or clear the contact fields.'});
        const address=typeof body.address==='string'?body.address.trim():'';
        const work=['Replacement','Repair','Coating / restoration','New installation'].includes(body.roofWork)?body.roofWork:'';
        if(!address||address.length>200||!work)return json(res,400,{error:'Provide the property address and the type of roof work.'});
        if(body.roofArea!==undefined&&(!Number.isFinite(Number(body.roofArea))||Number(body.roofArea)<=0||Number(body.roofArea)>10000000))return json(res,400,{error:'Roof area must be a positive number.'});
        let area=Number(body.roofArea)||null;
        let measuredNote='';
        if(!area&&measureRoof){
          try{const m=await measureRoof(address);if(m.available&&m.roofAreaSqFt){area=Math.round(m.roofAreaSqFt);measuredNote='Roof area measured from Google aerial imagery. Confirm on site.';}}
          catch{area=null;}
        }
        if(!area)return json(res,422,{error:'We could not measure this roof automatically. Please call us with your measurements for a quote.'});
        const roofSystem=String(body.roofSystem||'Other / not decided').slice(0,120);
        const lead={at:new Date().toISOString(),address,roofWork:work,area};
        if(consent&&contact.present){
          lead.contact={name:contact.name,email:contact.email,phone:contact.phone};
          lead.consentAt=new Date().toISOString();
          lead.consentTextVersion=CONSENT_TEXT_VERSION;
        }
        const cacheKey=[normalizeText(address).toLowerCase(),work,normalizeText(roofSystem).toLowerCase(),Math.round(Number(area))].join('|');
        const cached=cacheGet(cacheKey);
        if(cached){
          // A repeated lookup never reaches the paid AI path, but it still counts
          // toward the per-address hourly request budget.
          publicWindows.set(identity,[...seen,now]);
          await writeInstantLead(env,{...lead,total:cached.payload.total,servedFromCache:true});
          return json(res,200,{...cached.payload,cached:true,cachedAt:cached.cachedAt});
        }
        const pricing={laborRate:0,markup:15,contingency:0,tax:0};
        const input=inputSchema.parse({type:'roofing',answers:{address,roofWork:work,roofSystem,roofArea:String(area)},pricing,area});
        if(slots.public)return json(res,429,{error:'An estimate is being prepared. Please retry in a moment.'});
        if(globalRecent(now)>=globalCap)return json(res,429,{error:'The estimate service is busy right now. Please call us instead.'});
        slots.public=true;publicWindows.set(identity,[...seen,now]);globalTimes.push(now);
        const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),240000);
        try{
          const report=await generate(input,{apiKey:env.OPENAI_API_KEY,baseUrl:env.OPENAI_BASE_URL||'https://api.openai.com/v1',model:env.OPENAI_MODEL||'gpt-4.1',estimateModel:env.OPENAI_ESTIMATE_MODEL||'gpt-5.4-mini-2026-03-17',signal:controller.signal});
          const materials=report.items.reduce((sum,i)=>sum+(i.category!=='labor'?i.quantity*i.unitCost:0),0);
          const labor=report.items.reduce((sum,i)=>sum+(i.category==='labor'?i.laborHours*i.hourlyRate:0),0);
          const direct=Math.round((materials+labor)*100)/100;
          const fee=Math.round(direct*10)/100; // 10% Project Fee (rounds to cents)
          const markup=Math.round(direct*15)/100; // 15% standard markup
          const total=Math.round((direct+fee+markup)*100)/100;
          const payload={summary:report.summary,total,marketLow:report.marketRange?.low??null,marketMid:report.marketRange?Math.round(((report.marketRange.low+report.marketRange.high)/2)*100)/100:null,marketHigh:report.marketRange?.high??null,measuredNote,assumptions:report.assumptions.slice(0,6),followUps:report.questions.slice(0,4)};
          cacheSet(cacheKey,payload);
          await writeInstantLead(env,{...lead,total});
          return json(res,200,{...payload,cached:false,cachedAt:null});
        }catch{if(!res.destroyed)json(res,502,{error:'The instant estimate could not be completed. Please call us and we will quote it directly.'});}
        finally{clearTimeout(timeout);slots.public=false;}
        return;
      }

      if(req.url==='/api/ai/estimate'&&req.method==='POST'){
        if(!origins.has(req.headers.origin))return json(res,403,{error:'Request origin not allowed.'});
        if(!req.headers['content-type']?.startsWith('application/json'))return json(res,415,{error:'Use application/json.'});
        let identity=clientAddress(req,{trustProxy});
        if(production){const user=await portal.authenticate(req);identity=user.userId||user.id||user.email;if(!identity)return json(res,403,{error:'Your portal account is missing an identity.'});}
        if(!env.OPENAI_API_KEY)return json(res,503,{error:'The AI key is not configured on the server.'});
        const now=Date.now();prune(adminWindows,now,3600000);
        if(recent(adminWindows,identity,now,3600000).length>=12)return json(res,429,{error:'Your account has reached its hourly generation limit. Try again later.'});
        if(slots.admin)return json(res,429,{error:'An estimate is already being prepared. Please wait before retrying.'});
        let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>100000)return json(res,413,{error:'Job details are too large. Please shorten the notes.'});chunks.push(chunk);}
        let input;try{input=inputSchema.parse(JSON.parse(Buffer.concat(chunks).toString()));}catch{return json(res,400,{error:'Some job information is invalid. Check the answers and pricing settings.'});}
        if(typeof input.answers.address!=='string'||!input.answers.address.trim())return json(res,400,{error:'Enter the job address before requesting local research.'});
        const seen=recent(adminWindows,identity,now,3600000);
        slots.admin=true;adminWindows.set(identity,[...seen,now]);globalTimes.push(now);
        const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),240000);
        res.on('close',()=>{if(!res.writableEnded)controller.abort();});
        try{const estimate=await generate(input,{apiKey:env.OPENAI_API_KEY,baseUrl:env.OPENAI_BASE_URL||'http://127.0.0.1:8790/v1',model:env.OPENAI_MODEL||'gpt-4.1',estimateModel:env.OPENAI_ESTIMATE_MODEL||'gpt-5.4-mini-2026-03-17',signal:controller.signal});if(!res.destroyed)json(res,200,estimate);}
        catch{if(!res.destroyed)json(res,502,{error:controller.signal.aborted?'Research timed out. Your existing quote is unchanged. Please retry.':'Estimate generation failed. Your existing quote is unchanged. Please retry.'});}
        finally{clearTimeout(timeout);slots.admin=false;}
        return;
      }
      if(req.url?.startsWith('/api/'))return json(res,404,{error:'Not found'});
      if(!['GET','HEAD'].includes(req.method))return json(res,405,{error:'Method not allowed'});
      let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{return json(res,400,{error:'Invalid path'});}
      if(pathname.includes('\\')||pathname.split('/').some(part=>part.startsWith('.')))return json(res,404,{error:'Not found'});
      const root=resolve(staticDir);let file=resolve(root,'.'+pathname);
      if(!file.startsWith(root+sep)&&file!==root)return json(res,404,{error:'Not found'});
      if(pathname==='/'||(!extname(pathname)&&!pathname.startsWith('/assets/')))file=resolve(root,'index.html');
      if(!mime[extname(file)])return json(res,404,{error:'Not found'});
      try{const data=await readFile(file);res.writeHead(200,{'Content-Type':mime[extname(file)],'Cache-Control':pathname.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache'});res.end(req.method==='HEAD'?undefined:data);}catch{return json(res,404,{error:'Not found'});}
    }catch(error){if(!res.headersSent)json(res,[401,403,429].includes(error.status)?error.status:502,{error:[401,403,429].includes(error.status)?error.message:'The service could not complete the request. Please retry.'});else res.destroy();}
  });
  server.requestTimeout=260000;server.headersTimeout=20000;
  return server;
}
