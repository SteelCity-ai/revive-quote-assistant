import http from 'node:http';
import os from 'node:os';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {inputSchema,generateEstimate} from './estimate.mjs';
import {createPortalHandler} from './portal.mjs';
import {createRoofMeasurer} from './roof.mjs';
import {createVoiceHandler} from './voice.mjs';
import {createTypeSafeHandler} from './typesafe.mjs';
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.woff2':'font/woff2','.ico':'image/x-icon'};
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
export function createApp({env=process.env,fetcher=fetch,generate=generateEstimate,staticDir=resolve('dist')}={}){
  const production=env.NODE_ENV==='production';
  if(production&&(!env.APP_ORIGIN||new URL(env.APP_ORIGIN).protocol!=='https:'||new URL(env.APP_ORIGIN).origin!==env.APP_ORIGIN))throw new Error('Production requires an exact HTTPS APP_ORIGIN.');
  const hosts=['localhost','127.0.0.1',...Object.values(os.networkInterfaces()).flat().filter(a=>a?.family==='IPv4').map(a=>a.address)];
  const origins=new Set(production?[env.APP_ORIGIN]:hosts.map(host=>`http://${host}:4178`));
  const portal=createPortalHandler({baseUrl:env.PORTAL_API_URL||'https://portal.reviverepairco.com/api/v1',origins,fetcher,secureCookies:production});
  const measureRoof=createRoofMeasurer({fetcher,apiKey:env.GOOGLE_SOLAR_API_KEY||''});
  const roofWindows=new Map();
  const voice=createVoiceHandler({env,fetcher,authenticate:portal.authenticate,origins});
  const typesafe=createTypeSafeHandler({env,fetcher,authenticate:portal.authenticate,origins});
  const windows=new Map();let running=false;
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
        let identity=req.socket.remoteAddress;
        if(production){const user=await portal.authenticate(req);identity=user.userId||user.id||user.email;if(!identity)return json(res,403,{error:'Your portal account is missing an identity.'});}
        if(!measureRoof)return json(res,503,{error:'Roof measurement is not configured on the server.'});
        const now=Date.now();for(const [id,times] of roofWindows)if(times.every(t=>now-t>=3600000))roofWindows.delete(id);
        const recent=(roofWindows.get(identity)||[]).filter(t=>now-t<3600000);
        if(recent.length>=30)return json(res,429,{error:'Too many measurement requests this hour. Please wait before retrying.'});
        let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>2000)return json(res,413,{error:'The address is too long.'});chunks.push(chunk);}
        let body;try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{return json(res,400,{error:'Invalid request.'});}
        if(typeof body.address!=='string'||!body.address.trim())return json(res,400,{error:'Enter the job address before requesting a measurement.'});
        roofWindows.set(identity,[...recent,now]);
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
        const now=Date.now();for(const [id,times] of roofWindows)if(times.every(t=>now-t>=3600000))roofWindows.delete(id);
        const identity=req.socket.remoteAddress||'unknown';
        const seen=(roofWindows.get(identity)||[]).filter(t=>now-t<3600000);
        if(seen.length>=3)return json(res,429,{error:'Too many instant estimates from this address this hour. Please call us instead.'});
        let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>2000)return json(res,413,{error:'Request too large.'});chunks.push(chunk);}
        let body;try{body=JSON.parse(Buffer.concat(chunks).toString());}catch{return json(res,400,{error:'Invalid request.'});}
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
        const pricing={laborRate:0,markup:15,contingency:0,tax:0};
        const input=inputSchema.parse({type:'roofing',answers:{address,roofWork:work,roofSystem:String(body.roofSystem||'Other / not decided').slice(0,120),roofArea:String(area)},pricing,area});
        if(running)return json(res,429,{error:'An estimate is being prepared. Please retry in a moment.'});
        running=true;roofWindows.set(identity,[...seen,now]);
        const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),240000);
        try{
          const report=await generate(input,{apiKey:env.OPENAI_API_KEY,baseUrl:env.OPENAI_BASE_URL||'https://api.openai.com/v1',model:env.OPENAI_MODEL||'gpt-4.1',estimateModel:env.OPENAI_ESTIMATE_MODEL||'gpt-5.4-mini-2026-03-17',signal:controller.signal});
          const materials=report.items.reduce((sum,i)=>sum+(i.category!=='labor'?i.quantity*i.unitCost:0),0);
          const labor=report.items.reduce((sum,i)=>sum+(i.category==='labor'?i.laborHours*i.hourlyRate:0),0);
          const direct=Math.round((materials+labor)*100)/100;
          const fee=Math.round(direct*10)/100; // 10% Project Fee (rounds to cents)
          const markup=Math.round(direct*15)/100; // 15% standard markup
          const total=Math.round((direct+fee+markup)*100)/100;
          try{const {appendFile,mkdir}=await import('node:fs/promises');if(env.LEADS_DIR){await mkdir(env.LEADS_DIR,{recursive:true}).catch(()=>{});await appendFile(resolve(env.LEADS_DIR,'instant.jsonl'),JSON.stringify({at:new Date().toISOString(),address,roofWork:work,area,total})+'\n').catch(()=>{});}}catch{}
          return json(res,200,{summary:report.summary,total,marketLow:report.marketRange?.low??null,marketMid:report.marketRange?Math.round(((report.marketRange.low+report.marketRange.high)/2)*100)/100:null,marketHigh:report.marketRange?.high??null,measuredNote,assumptions:report.assumptions.slice(0,6),followUps:report.questions.slice(0,4)});
        }catch{if(!res.destroyed)json(res,502,{error:'The instant estimate could not be completed. Please call us and we will quote it directly.'});}
        finally{clearTimeout(timeout);running=false;}
        return;
      }

      if(req.url==='/api/ai/estimate'&&req.method==='POST'){
        if(!origins.has(req.headers.origin))return json(res,403,{error:'Request origin not allowed.'});
        if(!req.headers['content-type']?.startsWith('application/json'))return json(res,415,{error:'Use application/json.'});
        let identity=req.socket.remoteAddress;
        if(production){const user=await portal.authenticate(req);identity=user.userId||user.id||user.email;if(!identity)return json(res,403,{error:'Your portal account is missing an identity.'});}
        if(!env.OPENAI_API_KEY)return json(res,503,{error:'The AI key is not configured on the server.'});
        if(running)return json(res,429,{error:'An estimate is already being prepared. Please wait before retrying.'});
        const now=Date.now();for(const [id,times] of windows)if(times.every(t=>now-t>=3600000))windows.delete(id);
        if((windows.get(identity)||[]).filter(t=>now-t<3600000).length>=12)return json(res,429,{error:'Your account has reached its hourly generation limit. Try again later.'});
        let bytes=0;const chunks=[];for await(const chunk of req){bytes+=chunk.length;if(bytes>100000)return json(res,413,{error:'Job details are too large. Please shorten the notes.'});chunks.push(chunk);}
        let input;try{input=inputSchema.parse(JSON.parse(Buffer.concat(chunks).toString()));}catch{return json(res,400,{error:'Some job information is invalid. Check the answers and pricing settings.'});}
        if(typeof input.answers.address!=='string'||!input.answers.address.trim())return json(res,400,{error:'Enter the job address before requesting local research.'});
        if(running)return json(res,429,{error:'An estimate is already being prepared. Please wait before retrying.'});
        const recent=(windows.get(identity)||[]).filter(t=>Date.now()-t<3600000);if(recent.length>=12)return json(res,429,{error:'Your account has reached its hourly generation limit. Try again later.'});
        running=true;windows.set(identity,[...recent,Date.now()]);
        const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),240000);
        res.on('close',()=>{if(!res.writableEnded)controller.abort();});
        try{const estimate=await generate(input,{apiKey:env.OPENAI_API_KEY,baseUrl:env.OPENAI_BASE_URL||'http://127.0.0.1:8790/v1',model:env.OPENAI_MODEL||'gpt-4.1',estimateModel:env.OPENAI_ESTIMATE_MODEL||'gpt-5.4-mini-2026-03-17',signal:controller.signal});if(!res.destroyed)json(res,200,estimate);}
        catch{if(!res.destroyed)json(res,502,{error:controller.signal.aborted?'Research timed out. Your existing quote is unchanged. Please retry.':'Estimate generation failed. Your existing quote is unchanged. Please retry.'});}
        finally{clearTimeout(timeout);running=false;}
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
