import http from 'node:http';
import os from 'node:os';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {inputSchema,generateEstimate} from './estimate.mjs';
import {createPortalHandler} from './portal.mjs';
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webmanifest':'application/manifest+json','.woff2':'font/woff2','.ico':'image/x-icon'};
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
export function createApp({env=process.env,fetcher=fetch,generate=generateEstimate,staticDir=resolve('dist')}={}){
  const production=env.NODE_ENV==='production';
  if(production&&(!env.APP_ORIGIN||new URL(env.APP_ORIGIN).protocol!=='https:'||new URL(env.APP_ORIGIN).origin!==env.APP_ORIGIN))throw new Error('Production requires an exact HTTPS APP_ORIGIN.');
  const hosts=['localhost','127.0.0.1',...Object.values(os.networkInterfaces()).flat().filter(a=>a?.family==='IPv4').map(a=>a.address)];
  const origins=new Set(production?[env.APP_ORIGIN]:hosts.map(host=>`http://${host}:4178`));
  const portal=createPortalHandler({baseUrl:env.PORTAL_API_URL||'https://portal.reviverepairco.com/api/v1',origins,fetcher,secureCookies:production});
  const windows=new Map();let running=false;
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options','DENY');res.setHeader('Permissions-Policy','camera=(), microphone=(self), geolocation=()');
    if(production){res.setHeader('Strict-Transport-Security','max-age=31536000');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");}
    try{
      if(req.url==='/healthz'&&req.method==='GET')return json(res,200,{status:'ok',version:env.RELEASE_SHA||'development'});
      if(req.url==='/api/app/config'&&req.method==='GET')return json(res,200,{requiresLogin:production,voiceAvailable:false});
      if(await portal(req,res))return;
      if(req.url==='/api/ai/status'&&req.method==='GET')return json(res,200,{configured:!!env.OPENAI_API_KEY,model:env.OPENAI_ESTIMATE_MODEL||'gpt-5.4-mini-2026-03-17',researchModel:env.OPENAI_MODEL||'gpt-4.1',webResearch:true});
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
