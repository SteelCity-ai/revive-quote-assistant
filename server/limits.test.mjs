import {it,expect} from 'vitest';
import {createApp} from './app.mjs';
import {clientAddress,forwardedClient,isLoopback} from './identity.mjs';

const origin='https://quote.example.com';
const adminInput={type:'roofing',answers:{address:'QA test address'},pricing:{laborRate:50,markup:15,contingency:10,tax:6},area:100};
const publicBody={address:'1 Test Street',roofWork:'Replacement',roofArea:100};
const report={summary:'test estimate',items:[],assumptions:[],questions:[],marketRange:null};

const adminFetcher=async url=>{
  if(url.endsWith('/auth/login'))return new Response(JSON.stringify({role:'ADMIN',userId:'qa-admin'}),{headers:{'set-cookie':'revive_session=upstream-private; Secure; HttpOnly'}});
  return Response.json({role:'ADMIN',userId:'qa-admin'});
};

async function start(env,options={}){
  const server=createApp({env:{NODE_ENV:'production',APP_ORIGIN:origin,OPENAI_API_KEY:'test-only',...env},fetcher:adminFetcher,...options});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  return {server,base:`http://127.0.0.1:${server.address().port}`};
}

const post=(base,path,body,{cookie='',from=origin,forwarded}={})=>fetch(base+path,{method:'POST',headers:{Origin:from,'Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(forwarded?{'X-Forwarded-For':forwarded}:{})},body:JSON.stringify(body)});

it('resolves the rightmost forwarded address only from a loopback peer',()=>{
  expect(isLoopback('127.0.0.1')).toBe(true);
  expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
  expect(isLoopback('203.0.113.9')).toBe(false);
  const loopback={socket:{remoteAddress:'127.0.0.1'},headers:{'x-forwarded-for':'198.51.100.1, 203.0.113.7'}};
  expect(forwardedClient(loopback)).toBe('203.0.113.7');
  expect(clientAddress(loopback)).toBe('203.0.113.7');
  expect(clientAddress(loopback,{trustProxy:false})).toBe('127.0.0.1');
  const remote={socket:{remoteAddress:'203.0.113.9'},headers:{'x-forwarded-for':'198.51.100.1'}};
  expect(clientAddress(remote)).toBe('203.0.113.9');
  const malformed={socket:{remoteAddress:'127.0.0.1'},headers:{'x-forwarded-for':'not-an-ip'}};
  expect(clientAddress(malformed)).toBe('127.0.0.1');
});

it('applies the public instant limit per client instead of one shared bucket',async()=>{
  const {server,base}=await start({}, {generate:async()=>report});
  try{
    for(let i=0;i<3;i++)expect((await post(base,'/api/instant/estimate',publicBody,{forwarded:'203.0.113.10'})).status).toBe(200);
    expect((await post(base,'/api/instant/estimate',publicBody,{forwarded:'203.0.113.10'})).status).toBe(429);
    // A different visitor is unaffected by the first visitor's exhausted bucket.
    expect((await post(base,'/api/instant/estimate',publicBody,{forwarded:'203.0.113.11'})).status).toBe(200);
  }finally{await new Promise(r=>server.close(r));}
});

it('does not let a public estimate block an admin estimate',async()=>{
  let calls=0;
  const generate=async()=>{calls++;if(calls===1)await new Promise(r=>setTimeout(r,200));return report;};
  const {server,base}=await start({}, {generate});
  try{
    const login=await post(base,'/api/portal/login',{email:'qa@example.com',password:'test-only'});
    const cookie=login.headers.get('set-cookie').split(';')[0];
    const publicRequest=post(base,'/api/instant/estimate',publicBody,{forwarded:'203.0.113.20'});
    await new Promise(r=>setTimeout(r,40));
    const admin=await post(base,'/api/ai/estimate',adminInput,{cookie});
    expect(admin.status).toBe(200);
    expect((await publicRequest).status).toBe(200);
  }finally{await new Promise(r=>server.close(r));}
});

it('keys sign-in attempts by account plus address so one visitor cannot lock the office out',async()=>{
  const fetcher=async url=>{
    if(url.endsWith('/auth/login'))return new Response(JSON.stringify({role:'ADMIN',userId:'office-admin'}),{headers:{'set-cookie':'revive_session=office; Secure; HttpOnly'}});
    return Response.json({role:'ADMIN',userId:'office-admin'});
  };
  const {server,base}=await start({}, {fetcher});
  try{
    for(let i=0;i<10;i++)expect((await post(base,'/api/portal/login',{email:'office@example.com',password:'wrong'},{forwarded:'203.0.113.50'})).status).toBe(200);
    // The attacker's address has exhausted its bucket for this account.
    expect((await post(base,'/api/portal/login',{email:'office@example.com',password:'wrong'},{forwarded:'203.0.113.50'})).status).toBe(429);
    // The office signs in from its own address and is not locked out.
    expect((await post(base,'/api/portal/login',{email:'office@example.com',password:'test-only'},{forwarded:'198.51.100.7'})).status).toBe(200);
  }finally{await new Promise(r=>server.close(r));}
});
