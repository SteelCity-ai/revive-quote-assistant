import {it,expect} from 'vitest';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp,CONSENT_TEXT_VERSION} from './app.mjs';

const report={summary:'test estimate',items:[{category:'material',quantity:2,unitCost:100},{category:'labor',laborHours:2,hourlyRate:50}],assumptions:['assumed shingles'],questions:['confirm decking'],marketRange:{low:250,high:450}};
const base={address:'1 Test Street, Harrisburg, PA 17101',roofWork:'Replacement',roofArea:100};

async function start(options={}){
  const dir=await mkdtemp(join(tmpdir(),'revive-instant-test-'));
  const server=createApp({env:{OPENAI_API_KEY:'test-only',LEADS_DIR:dir},generate:async()=>report,...options});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  return {server,dir,baseUrl:`http://127.0.0.1:${server.address().port}`};
}
const post=(url,body,forwarded)=>fetch(url+'/api/instant/estimate',{method:'POST',headers:{'Content-Type':'application/json',...(forwarded?{'X-Forwarded-For':forwarded}:{})},body:JSON.stringify(body)});
const leads=async dir=>{try{return (await readFile(join(dir,'instant.jsonl'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}catch{return [];}};

it('still returns a price with zero contact fields and stores no contact data',async()=>{
  let calls=0;
  const {server,dir,baseUrl}=await start({generate:async()=>{calls++;return report;}});
  try{
    const response=await post(baseUrl,base);
    expect(response.status).toBe(200);
    const price=await response.json();
    expect(price.total).toBe(375);
    expect(price.cached).toBe(false);
    expect(calls).toBe(1);
    const [lead]=await leads(dir);
    expect(lead.contact).toBeUndefined();
    expect(lead.consentAt).toBeUndefined();
    expect(lead.consentTextVersion).toBeUndefined();
  }finally{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});

it('rejects contact data when consent is absent and never stores it',async()=>{
  let calls=0;
  const {server,dir,baseUrl}=await start({generate:async()=>{calls++;return report;}});
  try{
    const response=await post(baseUrl,{...base,contact:{name:'Pat Visitor',email:'pat@example.com',phone:'5555550100'},consent:false});
    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/permission/i);
    expect(calls).toBe(0);
    expect(await leads(dir)).toHaveLength(0);
  }finally{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});

it('validates email shape, phone length and field length caps',async()=>{
  const {server,dir,baseUrl}=await start({generate:async()=>report});
  try{
    const withConsent=contact=>({...base,contact,consent:true});
    expect((await post(baseUrl,withConsent({email:'not-an-email'}))).status).toBe(400);
    expect((await post(baseUrl,withConsent({phone:'123'}))).status).toBe(400);
    expect((await post(baseUrl,withConsent({name:'x'.repeat(121)}))).status).toBe(400);
    expect(await leads(dir)).toHaveLength(0);
  }finally{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});

it('stores contact data only with consent, including consent time and text version',async()=>{
  const {server,dir,baseUrl}=await start({generate:async()=>report});
  try{
    const response=await post(baseUrl,{...base,contact:{name:' Pat Visitor ',email:'PAT@Example.com',phone:'(555) 555-0100'},consent:true});
    expect(response.status).toBe(200);
    const [lead]=await leads(dir);
    expect(lead.contact).toEqual({name:'Pat Visitor',email:'pat@example.com',phone:'(555) 555-0100'});
    expect(Number.isNaN(Date.parse(lead.consentAt))).toBe(false);
    expect(lead.consentTextVersion).toBe(CONSENT_TEXT_VERSION);
  }finally{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});

it('serves an identical lookup from the six-hour cache in under 100 ms without a second AI call',async()=>{
  let calls=0;
  const {server,dir,baseUrl}=await start({generate:async()=>{calls++;return report;}});
  try{
    expect((await post(baseUrl,base)).status).toBe(200);
    const started=performance.now();
    const response=await post(baseUrl,{...base,address:'  1 test street, harrisburg, pa 17101  '});
    const elapsed=performance.now()-started;
    expect(response.status).toBe(200);
    const cached=await response.json();
    expect(cached.cached).toBe(true);
    expect(typeof cached.cachedAt).toBe('string');
    expect(elapsed).toBeLessThan(100);
    expect(calls).toBe(1);
    // A different input is a miss and calls the AI path again.
    expect((await post(baseUrl,{...base,roofWork:'Repair'})).status).toBe(200);
    expect(calls).toBe(2);
  }finally{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});

it('expires cache entries after the TTL',async()=>{
  let clock=1000;
  let calls=0;
  const {server,dir,baseUrl}=await start({now:()=>clock,cacheTtlMs:5000,generate:async()=>{calls++;return report;}});
  try{
    expect((await post(baseUrl,base)).status).toBe(200);
    clock+=4000;
    expect((await (await post(baseUrl,base)).json()).cached).toBe(true);
    clock+=2000;
    expect((await (await post(baseUrl,base)).json()).cached).toBe(false);
    expect(calls).toBe(2);
  }finally{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});

it('never caches a failed estimate',async()=>{
  let calls=0;
  const {server,dir,baseUrl}=await start({generate:async()=>{calls++;if(calls===1)throw new Error('AI unavailable');return report;}});
  try{
    expect((await post(baseUrl,base)).status).toBe(502);
    expect((await post(baseUrl,base)).status).toBe(200);
    expect(calls).toBe(2);
  }finally{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});
