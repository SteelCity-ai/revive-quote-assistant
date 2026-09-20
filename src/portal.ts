import type {Quote} from './domain';
import {newId} from './domain';
export type PortalUser={id?:string;userId?:string;displayName:string;role:string;email:string};
export type PortalStatus={configured:boolean;user:PortalUser|null;ready:boolean;error?:string;portalUrl?:string};
export type PortalReceipt={id:string;revision:number;approvedAt:string;status:string;projectId:string|null};
export type PortalSync={clientId:string;customerName:string;approvalId?:string;fingerprint?:string;receipt?:PortalReceipt;error?:string};
export async function portalRequest<T>(path:string,body?:unknown):Promise<T>{
  const response=await fetch(`/api/portal/${path}`,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  const data=await response.json().catch(()=>({error:'The portal connection is unavailable.'}));
  if(response.status===401)window.dispatchEvent(new Event('revive-session-expired'));
  if(!response.ok)throw new Error(data.error||'The portal could not save this quote.');return data;
}
export function portalSnapshot(q:Quote){return {id:q.id,type:q.type,kind:q.kind,answers:q.answers,lines:q.lines,pricing:q.pricing,assumptions:q.assumptions,exclusions:q.exclusions,terms:q.terms,acknowledged:true as const,...(q.ai?{ai:q.ai}:{})};}
export const approvalFingerprint=(q:Quote)=>JSON.stringify({clientId:q.portal?.clientId,quote:portalSnapshot(q)});
export function prepareApproval(q:Quote){
  const fingerprint=approvalFingerprint(q);
  const approvalId=q.portal?.fingerprint===fingerprint&&q.portal.approvalId?q.portal.approvalId:newId();
  return {approvalId,fingerprint,body:{clientId:q.portal?.clientId,approvalId,quote:portalSnapshot(q)}};
}
