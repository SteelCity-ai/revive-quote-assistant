import type {Line,Pricing,Quote} from './domain';
import {newId,derivedTitle} from './domain';
export type PortalUser={id?:string;userId?:string;displayName:string;role:string;email:string};
export type PortalStatus={configured:boolean;user:PortalUser|null;ready:boolean;error?:string;portalUrl?:string};
export type PortalReceipt={id:string;revision:number;approvedAt:string;status:string;projectId:string|null};
export type PortalLifecycle={id:string;threadId:string;revision:number;approvedAt:string;status:'APPROVED'|'ACCEPTED'|'SUPERSEDED';title?:string;customer?:string;total?:number;clientId?:string;projectId?:string|null;openedAt?:string|null;openedCount?:number;acceptedAt?:string|null;acceptedByName?:string|null;hasShare?:boolean};
export type PortalShare={shareToken:string;sharePath:string};
export type PortalSync={clientId:string;customerName:string;approvalId?:string;fingerprint?:string;receipt?:PortalReceipt;error?:string;threadId?:string;status?:PortalLifecycle['status'];openedAt?:string|null;openedCount?:number;acceptedAt?:string|null;acceptedByName?:string|null;hasShare?:boolean;sharePath?:string};
export async function portalRequest<T>(path:string,body?:unknown):Promise<T>{
  const response=await fetch(`/api/portal/${path}`,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json().catch(()=>({error:'The portal connection is unavailable.'}));
  if(response.status===401)window.dispatchEvent(new Event('revive-session-expired'));
  if(!response.ok)throw new Error(data.error||'The portal could not save this quote.');return data;
}
export function portalSnapshot(q:Quote){const answers=q.answers.title?q.answers:{...q.answers,title:derivedTitle(q)};return {id:q.id,type:q.type,kind:q.kind,answers,lines:q.lines,pricing:q.pricing,assumptions:q.assumptions,exclusions:q.exclusions,terms:q.terms,acknowledged:true as const,...(q.ai?{ai:q.ai}:{})};}
export const approvalFingerprint=(q:Quote)=>JSON.stringify({clientId:q.portal?.clientId,quote:portalSnapshot(q)});
export function prepareApproval(q:Quote){
  const fingerprint=approvalFingerprint(q);
  const approvalId=q.portal?.fingerprint===fingerprint&&q.portal.approvalId?q.portal.approvalId:newId();
  return {approvalId,fingerprint,body:{clientId:q.portal?.clientId,approvalId,quote:portalSnapshot(q)}};
}
// Revision-scoped lifecycle helpers. revisionId is the PortalReceipt.id (portal revision id).
export const fetchPortalLifecycle=(revisionId:string)=>portalRequest<PortalLifecycle>(`quotes/${revisionId}`);
export const fetchPortalShare=(revisionId:string)=>portalRequest<PortalShare>(`quotes/${revisionId}/share`);
export const rotatePortalShare=(revisionId:string)=>portalRequest<PortalShare>(`quotes/${revisionId}/share`,{});
// Assembly templates are served by the portal assembly API (arriving later); every field except
// id/name is optional here so the UI tolerates partial payloads instead of crashing on them.
export type PortalAssemblyLine={kind:'material'|'labor'|'accessory'|'waste'|'exclusion';description:string;quantity:number;unit:string;unitCost:number;wasteFactorPercent?:number|null;sort?:number|null};
export type PortalAssembly={id:string;slug?:string;name:string;trade?:string;description?:string;lineCount?:number;lines?:PortalAssemblyLine[]};
export const fetchPortalAssemblies=()=>portalRequest<{items:PortalAssembly[]}>('assemblies');
export const fetchPortalAssembly=(id:string)=>portalRequest<PortalAssembly>(`assemblies/${id}`);
// Maps an assembly template into quote lines, keeping the quote's own pricing settings.
// unitCost>0 -> priced line (labor lines become hours*rate, others quantity*material);
// unitCost<=0 -> allowance line the owner prices later; exclusions become description-only rows.
export function assemblyToQuoteLines(assembly:PortalAssembly,pricing:Pricing):Line[]{
  const template=assembly.lines??[];
  const priced=template.filter(l=>l.kind!=='exclusion').map(l=>{
    const allowance=!(l.unitCost>0);
    if(l.kind==='labor')return {id:newId(),description:l.description,quantity:l.quantity,unit:allowance?'allowance':(l.unit||'hrs'),material:0,hours:allowance?0:l.quantity,rate:allowance?pricing.laborRate:l.unitCost};
    return {id:newId(),description:l.description,quantity:l.quantity,unit:allowance?'allowance':(l.unit||'each'),material:allowance?0:l.unitCost,hours:0,rate:pricing.laborRate};
  });
  const exclusions=template.filter(l=>l.kind==='exclusion').map(l=>({id:newId(),description:l.description,quantity:0,unit:'exclusion',material:0,hours:0,rate:pricing.laborRate}));
  return [...priced,...exclusions];
}
