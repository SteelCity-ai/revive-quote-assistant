import {it,expect} from 'vitest';
import http from 'node:http';
import {createPortalHandler,portalUrl} from './portal.mjs';
it('keeps portal sessions private, rejects unauthenticated writes and restricts forwarded routes',async()=>{
  const calls=[];const upstream=async(url,init)=>{calls.push({url,init});if(url.endsWith('/auth/login'))return new Response(JSON.stringify({role:'ADMIN',displayName:'QA Admin'}),{headers:{'set-cookie':'revive_session=private-test-token; HttpOnly'}});if(url.endsWith('/me'))return Response.json({role:'ADMIN',displayName:'QA Admin'});if(url.endsWith('/quotes/capabilities'))return Response.json({version:1});return Response.json([]);};
  const handler=createPortalHandler({baseUrl:'https://portal.example/api/v1',origins:new Set(['http://localhost:4178','http://192.168.1.20:4178']),fetcher:upstream});
  const server=http.createServer((req,res)=>void handler(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=(path,body,cookie,origin='http://localhost:4178')=>fetch(base+path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
  try{
    expect((await post('/api/portal/quotes',{})).status).toBe(401);
    expect((await post('/api/portal/login',{},null,'https://evil.example')).status).toBe(403);expect(calls).toHaveLength(0);
    const phoneLogin=await post('/api/portal/login',{email:'qa@example.com',password:'test-only'},null,'http://192.168.1.20:4178');expect(phoneLogin.status).toBe(400);expect((await phoneLogin.json()).error).toContain('HTTPS');expect(calls).toHaveLength(0);
    const login=await post('/api/portal/login',{email:'qa@example.com',password:'test-only'});expect(login.status).toBe(200);expect(await login.text()).not.toContain('private-test-token');
    const cookie=login.headers.get('set-cookie').split(';')[0];expect(cookie).not.toContain('private-test-token');
    const status=await fetch(base+'/api/portal/status',{headers:{Cookie:cookie}});expect((await status.json()).ready).toBe(true);
    const response=await post('/api/portal/projects',{},cookie);expect(response.status).toBe(404);expect(calls.some(c=>c.url.endsWith('/projects'))).toBe(false);
    expect(calls.find(c=>c.url.endsWith('/me')).init.headers.Cookie).toBe('revive_session=private-test-token');
    await post('/api/portal/logout',{},cookie);expect((await post('/api/portal/quotes',{},cookie)).status).toBe(401);
  }finally{await new Promise(r=>server.close(r));}
});
it('requires encrypted remote portal URLs and rejects credential-bearing URLs',()=>{
  expect(()=>portalUrl('http://portal.example/api/v1')).toThrow();expect(()=>portalUrl('https://admin:password@portal.example')).toThrow();expect(portalUrl('http://127.0.0.1:3002/api/v1').hostname).toBe('127.0.0.1');
});
