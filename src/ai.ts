import type { Quote, Line } from './domain';
import { roofMeasurement } from './domain';
export type Source={id:string;title:string;url:string};
export type AIItem={description:string;category:'material'|'labor'|'equipment'|'disposal'|'subcontract'|'permit';quantity:number;unit:string;unitCost:number;laborHours:number;hourlyRate:number;basis:'listed-price'|'published-range'|'estimated-allowance';sourceIds:string[];rationale:string};
export type AIReport={summary:string;items:AIItem[];materials:{itemIndex:number;product:string;supplier:string;location:string;preference:'local'|'online'|'unverified';availability:string;sourceId:string|null}[];benchmarks:{label:string;kind:'documented-project'|'cost-guide';location:string;low:number;high:number;unit:'sq ft'|'total';projectArea:number|null;scopeMatch:'whole-project'|'component'|'context-only';sourceId:string;notes:string}[];assumptions:string[];exclusions:string[];questions:string[];researchGaps:string[];sources:Source[];researchedAt:string;model:string;area:number|null;researchNotes:string;fingerprint:string;lineIds:string[];resolvedQuestions:number[]};
export const fingerprint=(q:Quote)=>JSON.stringify({type:q.type,answers:q.answers,pricing:q.pricing});
export const evidenceChanged=(line:Line,item:AIItem)=>line.description!==item.description||line.quantity!==item.quantity||line.unit!==item.unit||line.material!==item.unitCost||line.hours!==item.laborHours||line.rate!==item.hourlyRate;
export function projectArea(q:Quote){if(q.type==='roofing')return roofMeasurement(q.answers).area;const n=Number(q.answers.workArea);return Number.isFinite(n)&&n>0?n:null;}
export async function generate(q:Quote,signal:AbortSignal):Promise<{report:AIReport;lines:Line[]}>{
  const response=await fetch('/api/ai/estimate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:q.type,answers:q.answers,pricing:q.pricing,area:projectArea(q)}),signal});
  let data;try{data=await response.json();}catch{throw new Error('The estimate server is unavailable. Your existing quote is unchanged. Please retry.');}
  if(response.status===401)window.dispatchEvent(new Event('revive-session-expired'));
  if(!response.ok)throw new Error(data.error||'Could not prepare the estimate. Please retry.');
  const report=data as AIReport;
  const lines=report.items.map((item,i)=>({id:`ai-${Date.now()}-${i}`,description:item.description,quantity:item.quantity,unit:item.unit,material:item.unitCost,hours:item.laborHours,rate:item.hourlyRate}));
  return {report:{...report,fingerprint:fingerprint(q),lineIds:lines.map(l=>l.id),resolvedQuestions:[]},lines};
}
export function comparisonRange(report:AIReport){
  return report.benchmarks.filter(b=>b.scopeMatch==='whole-project').flatMap(b=>{const divisor=b.unit==='sq ft'?1:b.projectArea;if(!divisor||divisor<=0)return [];return [{low:b.low/divisor,high:b.high/divisor}];});
}
