import {it,expect} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from './app.mjs';
const origin='https://quote.example.com';
const input={type:'roofing',answers:{address:'QA test address'},pricing:{laborRate:50,markup:15,contingency:10,tax:6},area:100};
it('fails closed without an exact production HTTPS origin',()=>{
  for(const APP_ORIGIN of [undefined,'http://quote.example.com','https://quote.example.com/path'])expect(()=>createApp({env:{NODE_ENV:'production',APP_ORIGIN}})).toThrow();
});
it('protects paid requests, bounds usage, validates current portal role and clears sessions',async()=>{
  let role='ADMIN',generated=0,upstreamCalls=0;
  const fetcher=async url=>{upstreamCalls++;if(url.endsWith('/auth/login'))return new Response(JSON.stringify({role,userId:'qa-admin',displayName:'QA'}),{headers:{'set-cookie':'revive_session=upstream-private; Secure; HttpOnly'}});return Response.json({role,userId:'qa-admin'});};
  const server=createApp({env:{NODE_ENV:'production',APP_ORIGIN:origin,OPENAI_API_KEY:'test-only'},fetcher,generate:async()=>{generated++;return {summary:'test estimate'};}});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  const post=(path,body,cookie='',from=origin)=>fetch(base+path,{method:'POST',headers:{Origin:from,'Content-Type':'application/json',Cookie:cookie},body:JSON.stringify(body)});
  try{
    expect((await post('/api/ai/estimate',input)).status).toBe(401);
    expect((await post('/api/ai/estimate',input,'','https://evil.example')).status).toBe(403);
    expect(generated).toBe(0);expect(upstreamCalls).toBe(0);
    const login=await post('/api/portal/login',{email:'qa@example.com',password:'test-only'});
    const setCookie=login.headers.get('set-cookie');expect(setCookie).toContain('Secure');expect(setCookie).toContain('HttpOnly');expect(setCookie).toContain('Path=/api;');expect(setCookie).not.toContain('upstream-private');const cookie=setCookie.split(';')[0];
    expect((await post('/api/ai/estimate',{},cookie)).status).toBe(400);
    for(let i=0;i<12;i++)expect((await post('/api/ai/estimate',input,cookie)).status).toBe(200);
    expect((await post('/api/ai/estimate',input,cookie)).status).toBe(429);expect(generated).toBe(12);
    role='CLIENT';expect((await post('/api/ai/estimate',input,cookie)).status).toBe(403);role='ADMIN';
    await post('/api/portal/logout',{},cookie);expect((await post('/api/ai/estimate',input,cookie)).status).toBe(401);
  }finally{await new Promise(r=>server.close(r));}
});
it('serves only built assets and rejects secret paths while exposing health and runtime configuration',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'revive-static-test-'));await writeFile(join(dir,'index.html'),'<h1>Revive</h1>');await writeFile(join(dir,'.env'),'PRIVATE_TEST_VALUE');
  const server=createApp({env:{NODE_ENV:'production',APP_ORIGIN:origin},staticDir:dir});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const page=await fetch(base+'/');expect(page.status).toBe(200);expect(page.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");expect(await page.text()).toContain('Revive');
    for(const path of ['/.env','/server/index.mjs','/package.json','/%2e%2e%5c.env','/api/missing'])expect((await fetch(base+path)).status).toBe(404);
    expect((await (await fetch(base+'/healthz')).json()).status).toBe('ok');expect((await (await fetch(base+'/api/app/config')).json()).requiresLogin).toBe(true);
  }finally{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
