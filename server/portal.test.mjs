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
it('proxies quote lifecycle and share routes for admins only, with idempotent share reads',async()=>{
  const uuid='a1b2c3d4-0000-4000-8000-000000000000';
  const calls=[];const lifecycle={id:uuid,threadId:'thread-1',revision:2,approvedAt:'2026-09-26T10:00:00Z',status:'APPROVED',title:'Roof repair',customer:'Pat',total:1234.5,clientId:'client-1',projectId:null,openedAt:null,openedCount:0,acceptedAt:null,acceptedByName:null,hasShare:false};
  const upstream=async(url,init)=>{calls.push({url,method:init?.method||'GET'});
    if(url.endsWith('/auth/login'))return new Response(JSON.stringify({role:'ADMIN',displayName:'QA Admin'}),{headers:{'set-cookie':'revive_session=lifecycle-test-token; HttpOnly'}});
    if(url.endsWith('/me'))return Response.json({role:'ADMIN',displayName:'QA Admin'});
    if(url.endsWith('/quotes/capabilities'))return Response.json({version:1});
    if(url.endsWith(`/quotes/${uuid}/share`))return Response.json(init?.method==='POST'?{shareToken:'rotated-token',sharePath:'/q/rotated-token'}:{shareToken:'stable-token',sharePath:'/q/stable-token'});
    if(url.endsWith(`/quotes/${uuid}`))return Response.json(lifecycle);
    return Response.json({});};
  const handler=createPortalHandler({baseUrl:'https://portal.example/api/v1',origins:new Set(['http://localhost:4178']),fetcher:upstream});
  const server=http.createServer((req,res)=>void handler(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  const get=(path,cookie)=>fetch(base+path,{headers:{...(cookie?{Cookie:cookie}:{})}});
  const post=(path,body,cookie)=>fetch(base+path,{method:'POST',headers:{Origin:'http://localhost:4178','Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
  try{
    expect((await get(`/api/portal/quotes/${uuid}`)).status).toBe(401);
    expect(calls.filter(c=>c.url.endsWith(`/quotes/${uuid}`))).toHaveLength(0);
    const login=await post('/api/portal/login',{email:'qa@example.com',password:'test-only'},null);
    const cookie=login.headers.get('set-cookie').split(';')[0];
    expect((await get(`/api/portal/quotes/${uuid}/versions`,cookie)).status).toBe(404);
    expect((await fetch(base+`/api/portal/quotes/${uuid}`,{method:'DELETE',headers:{Origin:'http://localhost:4178','Content-Type':'application/json',Cookie:cookie}})).status).toBe(404);
    expect((await post(`/api/portal/quotes/${uuid}`,{},cookie)).status).toBe(404);
    expect(calls.some(c=>c.url.endsWith(`/quotes/${uuid}/versions`))).toBe(false);
    expect(calls.some(c=>c.url.endsWith(`/quotes/${uuid}`)&&c.method==='DELETE')).toBe(false);
    const quoted=await get(`/api/portal/quotes/${uuid}`,cookie);expect(quoted.status).toBe(200);
    expect(await quoted.json()).toEqual(expect.objectContaining({id:uuid,status:'APPROVED',openedCount:0}));
    const firstShare=await get(`/api/portal/quotes/${uuid}/share`,cookie);expect(firstShare.status).toBe(200);
    expect(await firstShare.json()).toEqual({shareToken:'stable-token',sharePath:'/q/stable-token'});
    const secondShare=await get(`/api/portal/quotes/${uuid}/share`,cookie);expect(secondShare.status).toBe(200);
    expect(await secondShare.json()).toEqual({shareToken:'stable-token',sharePath:'/q/stable-token'});
    const rotated=await post(`/api/portal/quotes/${uuid}/share`,{},cookie);expect(rotated.status).toBe(200);
    expect((await rotated.json()).shareToken).toBe('rotated-token');
    expect(calls.filter(c=>c.url.endsWith(`/quotes/${uuid}/share`)&&c.method==='GET')).toHaveLength(2);
    expect(calls.filter(c=>c.url.endsWith(`/quotes/${uuid}/share`)&&c.method==='POST')).toHaveLength(1);
  }finally{await new Promise(r=>server.close(r));}
});
it('proxies assembly templates for admins only, on exact routes with query forwarding',async()=>{
  const uuid='b2c3d4e5-0000-4000-8000-0000000000aa';
  const calls=[];const assembly={id:uuid,slug:'tpo-replacement',name:'TPO replacement',trade:'Roofing',lineCount:4};
  const upstream=async(url,init)=>{calls.push({url:String(url),method:init?.method||'GET'});
    if(url.endsWith('/auth/login'))return new Response(JSON.stringify({role:'ADMIN',displayName:'QA Admin'}),{headers:{'set-cookie':'revive_session=assembly-test-token; HttpOnly'}});
    if(url.endsWith('/me'))return Response.json({role:'ADMIN',displayName:'QA Admin'});
    if(url.endsWith('/quotes/capabilities'))return Response.json({version:1});
    if(url.split('?')[0].endsWith('/assemblies'))return Response.json({items:[assembly]});
    if(url.endsWith(`/assemblies/${uuid}`))return Response.json({...assembly,lines:[]});
    return Response.json({});};
  const handler=createPortalHandler({baseUrl:'https://portal.example/api/v1',origins:new Set(['http://localhost:4178']),fetcher:upstream});
  const server=http.createServer((req,res)=>void handler(req,res));await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base=`http://127.0.0.1:${server.address().port}`;
  const get=(path,cookie)=>fetch(base+path,{headers:{...(cookie?{Cookie:cookie}:{})}});
  const post=(path,body,cookie)=>fetch(base+path,{method:'POST',headers:{Origin:'http://localhost:4178','Content-Type':'application/json',...(cookie?{Cookie:cookie}:{})},body:JSON.stringify(body)});
  try{
    expect((await get('/api/portal/assemblies')).status).toBe(401);
    expect(calls.some(c=>c.url.endsWith('/assemblies'))).toBe(false);
    const login=await post('/api/portal/login',{email:'qa@example.com',password:'test-only'},null);
    const cookie=login.headers.get('set-cookie').split(';')[0];
    expect((await post('/api/portal/assemblies',{},cookie)).status).toBe(404);
    expect((await fetch(base+`/api/portal/assemblies/${uuid}`,{method:'DELETE',headers:{Origin:'http://localhost:4178','Content-Type':'application/json',Cookie:cookie}})).status).toBe(404);
    expect((await get(`/api/portal/assemblies/${uuid}/lines`,cookie)).status).toBe(404);
    expect(calls.some(c=>c.url.includes('/assemblies'))).toBe(false);
    const list=await get('/api/portal/assemblies?trade=Roofing&search=tpo',cookie);expect(list.status).toBe(200);
    expect(await list.json()).toEqual({items:[assembly]});
    const one=await get(`/api/portal/assemblies/${uuid}`,cookie);expect(one.status).toBe(200);
    expect(await one.json()).toEqual(expect.objectContaining({id:uuid,name:'TPO replacement',lines:[]}));
    expect(calls.find(c=>c.url.split('?')[0].endsWith('/assemblies')).url).toBe('https://portal.example/api/v1/assemblies?trade=Roofing&search=tpo');
    expect(calls.some(c=>c.url.endsWith(`/assemblies/${uuid}`)&&c.method==='GET')).toBe(true);
    expect(calls.some(c=>c.method!=='GET'&&c.url.includes('/assemblies'))).toBe(false);
  }finally{await new Promise(r=>server.close(r));}
});
