import {it,expect,afterEach} from 'vitest';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {recordGeneration,summarizeAudit,errorCodeFor,sanitizeEntry} from './audit.mjs';
import {generateEstimate} from './estimate.mjs';
import {createApp} from './app.mjs';

const report={summary:'test estimate',items:[{category:'material',quantity:2,unitCost:100},{category:'labor',laborHours:2,hourlyRate:50}],assumptions:['assumed shingles'],questions:['confirm decking'],marketRange:{low:250,high:450},usage:{inputTokens:300,outputTokens:120,totalTokens:420,calls:3},durationMs:1234};
const base={address:'1 Secret Street, Harrisburg, PA 17101',roofWork:'Replacement',roofArea:100};

const readLines=async file=>{
  try{return (await readFile(file,'utf8')).split('\n').filter(Boolean);}catch{return [];}
};

it('appends exactly one whitelisted JSON line and creates the directory',async()=>{
  const root=await mkdtemp(join(tmpdir(),'revive-audit-'));
  const dir=join(root,'nested','audit');
  try{
    const entry={at:'2026-11-10T12:00:00.000Z',route:'instant',outcome:'success',model:'gpt-4.1',estimateModel:'gpt-5.4-mini',durationMs:1234.567,usage:{inputTokens:10,outputTokens:5,totalTokens:15,calls:3},itemCount:4,total:999.5,
      address:'1 Secret Street',customer:'Pat Visitor',email:'pat@example.com',phone:'5555550100',notes:'gate code 1234',answers:{address:'1 Secret Street'},prompt:'raw prompt',sources:[{url:'https://supplier.example/product'}]};
    const record=await recordGeneration(entry,{dir});
    const lines=await readLines(join(dir,'generations.jsonl'));
    expect(lines).toHaveLength(1);
    const parsed=JSON.parse(lines[0]);
    expect(parsed).toEqual({at:'2026-11-10T12:00:00.000Z',route:'instant',outcome:'success',model:'gpt-4.1',estimateModel:'gpt-5.4-mini',durationMs:1234.57,usage:{inputTokens:10,outputTokens:5,totalTokens:15,calls:3},itemCount:4,total:999.5});
    expect(record).toEqual(parsed);
    const serialized=JSON.stringify(parsed);
    for(const secret of ['Secret Street','Pat Visitor','pat@example.com','5555550100','gate code','raw prompt','supplier.example'])expect(serialized).not.toContain(secret);
  }finally{await rm(root,{recursive:true,force:true});}
});

it('never throws when the audit directory cannot be written',async()=>{
  const root=await mkdtemp(join(tmpdir(),'revive-audit-'));
  const file=join(root,'not-a-directory');
  await writeFile(file,'x');
  try{
    await expect(recordGeneration({route:'instant',outcome:'success'},{dir:file})).resolves.toBeNull();
    await expect(recordGeneration({route:'instant'},{})).resolves.toBeNull();
  }finally{await rm(root,{recursive:true,force:true});}
});

it('summarizes mixed success and failure lines and tolerates malformed input',()=>{
  const lines=[
    JSON.stringify({at:'2026-11-10T12:00:00.000Z',route:'instant',outcome:'success',model:'gpt-4.1',durationMs:1000,usage:{inputTokens:100,outputTokens:50,totalTokens:150,calls:3},total:500}),
    JSON.stringify({at:'2026-11-10T12:01:00.000Z',route:'ai',outcome:'success',model:'gpt-4.1',durationMs:3000,usage:{inputTokens:200,outputTokens:100,totalTokens:300,calls:3}}),
    JSON.stringify({at:'2026-11-10T12:02:00.000Z',route:'instant',outcome:'failure',errorCode:'timeout',model:'gpt-4.1',durationMs:2000}),
    '{not json',
    '',
    'null'
  ];
  const summary=summarizeAudit(lines);
  expect(summary.generations).toBe(3);
  expect(summary.failures).toBe(1);
  expect(summary.successes).toBe(2);
  expect(summary.failuresByCode).toEqual({timeout:1});
  expect(summary.tokens).toEqual({input:300,output:150,total:450});
  expect(summary.durationMs).toEqual({mean:2000,p95:3000,count:3});
  expect(summary.byRoute.instant).toEqual({generations:2,failures:1,inputTokens:100,outputTokens:50,meanDurationMs:1500});
  expect(summary.byRoute.ai).toEqual({generations:1,failures:0,inputTokens:200,outputTokens:100,meanDurationMs:3000});
  expect(summary.byModel['gpt-4.1'].generations).toBe(3);
  expect(summary.malformed).toBe(2);
});

it('computes p95 from the sorted durations and handles an empty log',()=>{
  const lines=[100,200,300,400,500].map(durationMs=>JSON.stringify({route:'ai',outcome:'success',durationMs}));
  expect(summarizeAudit(lines).durationMs).toEqual({mean:300,p95:500,count:5});
  expect(summarizeAudit([])).toMatchObject({generations:0,failures:0,tokens:{input:0,output:0,total:0},durationMs:{mean:0,p95:0,count:0},malformed:0});
});

it('maps failures to short sanitized codes and drops unknown fields',()=>{
  expect(errorCodeFor(Object.assign(new Error('x'),{name:'AbortError'}))).toBe('timeout');
  expect(errorCodeFor(new Error('The AI service is rate limited. Please try again shortly.'))).toBe('rate_limited');
  expect(errorCodeFor(new Error('OpenAI API billing or credit needs attention.'))).toBe('quota');
  expect(errorCodeFor(new Error('AI response was incomplete. No estimate was applied.'))).toBe('incomplete');
  expect(errorCodeFor(new Error('AI returned an unreadable estimate.'))).toBe('unreadable_output');
  expect(errorCodeFor(new Error('Estimate referenced an unverified source.'))).toBe('validation_failed');
  expect(errorCodeFor(new Error('something unexpected with sk-secret-key'))).toBe('generation_failed');
  expect(errorCodeFor(null)).toBe('unknown');
  expect(sanitizeEntry({route:'instant',address:'1 Secret Street',total:'12.345'})).toEqual({route:'instant',total:12.35});
});

async function startApp(options={}){
  const dir=await mkdtemp(join(tmpdir(),'revive-audit-app-'));
  const server=createApp({env:{OPENAI_API_KEY:'test-only',LEADS_DIR:dir,AUDIT_DIR:dir},...options});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  return {server,dir,baseUrl:`http://127.0.0.1:${server.address().port}`};
}
const post=(url,body)=>fetch(url+'/api/instant/estimate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});

it('writes one audit record per instant generation without any customer data',async()=>{
  const records=[];
  const {server,dir,baseUrl}=await startApp({generate:async()=>report,audit:async entry=>{records.push(entry);}});
  try{
    const response=await post(baseUrl,{...base,contact:{name:'Pat Visitor',email:'pat@example.com',phone:'5555550100'},consent:true});
    expect(response.status).toBe(200);
    expect(records).toHaveLength(1);
    const [record]=records;
    expect(record).toMatchObject({route:'instant',outcome:'success',model:'gpt-4.1',estimateModel:'gpt-5.4-mini-2026-03-17',durationMs:1234,usage:{inputTokens:300,outputTokens:120,totalTokens:420,calls:3},itemCount:2,total:375});
    expect(typeof record.at).toBe('string');
    const serialized=JSON.stringify(record);
    for(const secret of ['Secret Street','Pat Visitor','pat@example.com','5555550100','Harrisburg','assumed shingles','confirm decking'])expect(serialized).not.toContain(secret);
  }finally{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});

it('writes a failure record with a sanitized code and keeps the HTTP response unchanged',async()=>{
  const records=[];
  const {server,dir,baseUrl}=await startApp({generate:async()=>{throw new Error('AI service request failed (HTTP 500). Please retry.');},audit:async entry=>{records.push(entry);}});
  try{
    const response=await post(baseUrl,base);
    expect(response.status).toBe(502);
    expect((await response.json()).error).toMatch(/could not be completed/i);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({route:'instant',outcome:'failure',errorCode:'generation_failed'});
    expect(records[0].usage).toBeUndefined();
    expect(JSON.stringify(records[0])).not.toContain('HTTP 500');
  }finally{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});

it('keeps the response intact when the audit writer throws or rejects',async()=>{
  for(const audit of [()=>{throw new Error('disk full');},async()=>{throw new Error('disk full');}]){
    const {server,dir,baseUrl}=await startApp({generate:async()=>report,audit});
    try{
      const response=await post(baseUrl,base);
      expect(response.status).toBe(200);
      expect((await response.json()).total).toBe(375);
    }finally{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
  }
});

it('audits the admin route and keeps usage out of the client estimate payload',async()=>{
  const records=[];
  const {server,dir,baseUrl}=await startApp({generate:async()=>({summary:'test estimate',items:[{category:'material',quantity:1,unitCost:10}],usage:{inputTokens:10,outputTokens:5,totalTokens:15,calls:3},durationMs:777}),audit:async entry=>{records.push(entry);}});
  try{
    const response=await fetch(baseUrl+'/api/ai/estimate',{method:'POST',headers:{Origin:'http://127.0.0.1:4178','Content-Type':'application/json'},body:JSON.stringify({type:'roofing',answers:{address:'QA test address'},pricing:{laborRate:50,markup:15,contingency:10,tax:6},area:100})});
    expect(response.status).toBe(200);
    const body=await response.json();
    expect(body.usage).toBeUndefined();
    expect(body.durationMs).toBeUndefined();
    expect(body.summary).toBe('test estimate');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({route:'ai',outcome:'success',durationMs:777,usage:{inputTokens:10,outputTokens:5,totalTokens:15,calls:3},itemCount:1});
  }finally{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});

it('persists the audit line to disk through the default writer',async()=>{
  const {server,dir,baseUrl}=await startApp({generate:async()=>report});
  try{
    expect((await post(baseUrl,base)).status).toBe(200);
    let lines=[];
    for(let attempt=0;attempt<50&&!lines.length;attempt++){
      lines=await readLines(join(dir,'generations.jsonl'));
      if(!lines.length)await new Promise(r=>setTimeout(r,20));
    }
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({route:'instant',outcome:'success',itemCount:2,total:375});
  }finally{await new Promise(r=>server.close(r));await rm(dir,{recursive:true,force:true});}
});

const originalFetch=globalThis.fetch;
afterEach(()=>{globalThis.fetch=originalFetch;});

it('captures usage from all three Responses API calls and reports duration',async()=>{
  const raw={summary:'Test scope',items:[{description:'Floor material',category:'material',quantity:10,unit:'each',unitCost:30,laborHours:0,hourlyRate:0,basis:'listed-price',sourceIds:['S1'],rationale:'10 boxes at published unit price.',material:{product:'Flooring box',supplier:'Supplier',location:'Harrisburg',preference:'local',availability:'Verify stock',sourceId:'S1'}}],benchmarks:[],assumptions:[],exclusions:[],questions:[],researchGaps:[]};
  const research={status:'completed',output:[{type:'web_search_call',status:'completed'},{type:'message',content:[{type:'output_text',text:'findings',annotations:[{type:'url_citation',url:'https://supplier.example/product',title:'Product'}]}]}],usage:{input_tokens:100,output_tokens:50,total_tokens:150}};
  const draft={status:'completed',output:[{type:'message',content:[{type:'output_text',text:JSON.stringify(raw)}]}],usage:{input_tokens:200,output_tokens:80,total_tokens:280}};
  let calls=0;
  globalThis.fetch=async(url,options)=>{
    calls++;
    const body=JSON.parse(options.body);
    const payload=String(body.input).includes('commercial contractor estimator')?draft:research;
    return new Response(JSON.stringify(payload),{status:200,headers:{'content-type':'application/json'}});
  };
  const result=await generateEstimate({type:'roofing',answers:{address:'Harrisburg'},pricing:{laborRate:0,markup:15,contingency:0,tax:0},area:100},{apiKey:'test-only',baseUrl:'https://api.example/v1',model:'gpt-4.1'});
  expect(calls).toBe(3);
  expect(result.usage).toEqual({inputTokens:400,outputTokens:180,totalTokens:580,calls:3});
  expect(typeof result.durationMs).toBe('number');
  expect(result.durationMs).toBeGreaterThanOrEqual(0);
  expect(result.items).toHaveLength(1);
});
