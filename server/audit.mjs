import {appendFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';

// One durable line per AI generation. The record is deliberately a closed
// whitelist: nothing from the request body, prompt, research or estimate can
// reach the file unless it is one of these fields. That keeps addresses,
// customer names, contact details, notes, job answers and source URLs out by
// construction rather than by remembering to delete them.
const FIELDS=['at','route','outcome','errorCode','model','estimateModel','durationMs','usage','itemCount','total'];
const TEXT_LIMIT=120;

const finite=(value,{min=0,max=Number.MAX_SAFE_INTEGER}={})=>{
  const number=Number(value);
  return Number.isFinite(number)&&number>=min&&number<=max?number:undefined;
};
const round=(value,places=2)=>{const factor=10**places;return Math.round(value*factor)/factor;};

export function normalizeUsage(usage){
  if(!usage||typeof usage!=='object')return undefined;
  const inputTokens=finite(usage.inputTokens);
  const outputTokens=finite(usage.outputTokens);
  const totalTokens=finite(usage.totalTokens)??(inputTokens!==undefined&&outputTokens!==undefined?inputTokens+outputTokens:undefined);
  const calls=finite(usage.calls);
  const normalized={};
  if(inputTokens!==undefined)normalized.inputTokens=inputTokens;
  if(outputTokens!==undefined)normalized.outputTokens=outputTokens;
  if(totalTokens!==undefined)normalized.totalTokens=totalTokens;
  if(calls!==undefined)normalized.calls=calls;
  return Object.keys(normalized).length?normalized:undefined;
}

export function sanitizeEntry(entry={}){
  const record={};
  for(const key of FIELDS){
    const value=entry?.[key];
    if(value===undefined||value===null)continue;
    if(key==='usage'){const usage=normalizeUsage(value);if(usage)record.usage=usage;continue;}
    if(key==='durationMs'||key==='itemCount'||key==='total'){
      const number=finite(value);
      if(number!==undefined)record[key]=round(number);
      continue;
    }
    if(typeof value==='string'){
      const text=value.trim();
      if(text)record[key]=text.slice(0,TEXT_LIMIT);
    }
  }
  return record;
}

// Best effort by design: a missing directory, a read-only volume or a full disk
// must never surface in the request path. Callers fire and forget.
export async function recordGeneration(entry,{dir}={}){
  try{
    if(!dir)return null;
    const record=sanitizeEntry(entry);
    if(!record.at)record.at=new Date().toISOString();
    await mkdir(dir,{recursive:true});
    await appendFile(resolve(dir,'generations.jsonl'),JSON.stringify(record)+'\n');
    return record;
  }catch{return null;}
}

// Short, stable tokens only. Never a stack, message body, key or URL.
export function errorCodeFor(error){
  if(!error)return 'unknown';
  const name=String(error.name||'');
  const message=String(error.message||'');
  if(name==='AbortError'||/abort/i.test(name)||/timed out|timeout/i.test(message))return 'timeout';
  if(/rate limit/i.test(message))return 'rate_limited';
  if(/billing|credit|quota/i.test(message))return 'quota';
  if(/API key|rejected/i.test(message))return 'auth';
  if(/incomplete/i.test(message))return 'incomplete';
  if(/unreadable/i.test(message))return 'unreadable_output';
  if(/no estimate lines|no usable citations|did not complete/i.test(message))return 'research_failed';
  if(/unverified source|missing its source|incomplete or duplicate|did not reconcile|not verified|invalid pricing comparison|missing from the shopping list/i.test(message))return 'validation_failed';
  return 'generation_failed';
}

const percentile=(sorted,p)=>{
  if(!sorted.length)return 0;
  const index=Math.min(sorted.length-1,Math.max(0,Math.ceil(p*sorted.length)-1));
  return sorted[index];
};

const emptyBucket=()=>({generations:0,failures:0,inputTokens:0,outputTokens:0,durations:[]});
const finishBucket=bucket=>({
  generations:bucket.generations,
  failures:bucket.failures,
  inputTokens:bucket.inputTokens,
  outputTokens:bucket.outputTokens,
  meanDurationMs:bucket.durations.length?round(bucket.durations.reduce((sum,value)=>sum+value,0)/bucket.durations.length,1):0
});

// Pure: accepts JSONL strings (or already parsed objects) and tolerates blank
// and malformed lines without throwing.
export function summarizeAudit(lines=[]){
  const records=[];
  let malformed=0;
  for(const line of Array.isArray(lines)?lines:[]){
    if(line&&typeof line==='object'&&!Array.isArray(line)){records.push(line);continue;}
    if(typeof line!=='string'){malformed++;continue;}
    const text=line.trim();
    if(!text)continue;
    try{
      const parsed=JSON.parse(text);
      if(parsed&&typeof parsed==='object'&&!Array.isArray(parsed))records.push(parsed);
      else malformed++;
    }catch{malformed++;}
  }
  const failuresByCode={};
  const byRoute={};
  const byModel={};
  const durations=[];
  let failures=0,inputTokens=0,outputTokens=0,totalTokens=0;
  for(const record of records){
    const failed=record.outcome==='failure';
    if(failed){
      failures++;
      const code=typeof record.errorCode==='string'&&record.errorCode?record.errorCode:'unknown';
      failuresByCode[code]=(failuresByCode[code]||0)+1;
    }
    const usage=normalizeUsage(record.usage)||{};
    const input=usage.inputTokens||0;
    const output=usage.outputTokens||0;
    inputTokens+=input;
    outputTokens+=output;
    totalTokens+=usage.totalTokens??input+output;
    const duration=finite(record.durationMs);
    if(duration!==undefined)durations.push(duration);
    const route=typeof record.route==='string'&&record.route?record.route:'unknown';
    const model=typeof record.model==='string'&&record.model?record.model:'unknown';
    for(const [map,key] of [[byRoute,route],[byModel,model]]){
      const bucket=map[key]||(map[key]=emptyBucket());
      bucket.generations++;
      if(failed)bucket.failures++;
      bucket.inputTokens+=input;
      bucket.outputTokens+=output;
      if(duration!==undefined)bucket.durations.push(duration);
    }
  }
  const sorted=[...durations].sort((a,b)=>a-b);
  const summarizeMap=map=>Object.fromEntries(Object.entries(map).map(([key,bucket])=>[key,finishBucket(bucket)]));
  return {
    generations:records.length,
    failures,
    successes:records.length-failures,
    failuresByCode,
    tokens:{input:inputTokens,output:outputTokens,total:totalTokens},
    durationMs:{
      mean:sorted.length?round(sorted.reduce((sum,value)=>sum+value,0)/sorted.length,1):0,
      p95:round(percentile(sorted,0.95),1),
      count:sorted.length
    },
    byRoute:summarizeMap(byRoute),
    byModel:summarizeMap(byModel),
    malformed
  };
}
