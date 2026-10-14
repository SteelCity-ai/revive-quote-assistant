import {makeQuote} from './domain';
import type {JobType,Pricing,Quote} from './domain';
import {fingerprint,projectArea} from './ai';
import type {AIReport,RoofMeasure} from './ai';
export type ImportedEstimate={id:string;provider:'Symplewyse';filename:string;estimateNumber:string;issuedAt:string;total:number|null;currency:'USD';customer:string;contact:string;address:string;type:JobType;roofWork:string;roofSystem:string;workArea:number|null;scope:string;sourceTerms?:string;warnings:string[];importedAt:string;roofMeasurement:RoofMeasure|null;status?:string;error?:string;report?:AIReport;reportPricing?:Pricing;};
export function pricingScope(scope:string){return scope.replace(/(?:USD\s*|\$)\s*\d[\d,]*(?:\.\d{1,2})?/gi,'[imported price omitted]').split('\n').filter(line=>!/^\s*(?:subtotal|total|tax|discount|unit price|amount|price|budget|estimate price)\b/i.test(line)).join('\n').trim();}
export function quoteFromImport(source:ImportedEstimate,pricing:Pricing,roofArea?:number):Quote {
  const quote=makeQuote(source.type,pricing);const scope=pricingScope(source.scope);
  quote.answers={address:source.address,customer:source.customer,contact:source.contact,title:`${source.estimateNumber} · ${source.type==='roofing'?'Roofing':'Imported project'}`,description:scope.slice(0,6000),notes:scope.slice(6000,12000)};
  if(source.type==='roofing'){
    quote.answers.roofWork=source.roofWork;quote.answers.roofSystem=source.roofSystem;
    if(roofArea){quote.answers.roofArea=String(roofArea);quote.answers.measurementSource=source.roofMeasurement?.roofAreaSqFt===roofArea?'Google aerial imagery':'Confirmed manual area';quote.answers.measurementProvenance=source.roofMeasurement?.roofAreaSqFt===roofArea?JSON.stringify(source.roofMeasurement):'Manual roof surface area confirmed during import';}
  }else if(source.workArea)quote.answers.workArea=String(source.workArea);
  // Comparison metadata stays outside answers, costs and research payloads.
  quote.sourceImport={...source,report:undefined};
  return quote;
}
export function applyImportedReport(quote:Quote,report:AIReport):Quote {
  const lines=report.items.map((item,i)=>({id:`ai-${quote.id}-${i}`,description:item.description,quantity:item.quantity,unit:item.unit,material:item.unitCost,hours:item.laborHours,rate:item.hourlyRate}));
  return {...quote,stage:'pricing',lines,assumptions:report.assumptions.join('\n'),exclusions:report.exclusions.join('\n'),ai:{...report,area:projectArea(quote),fingerprint:fingerprint(quote),lineIds:lines.map(l=>l.id),resolvedQuestions:[]}};
}
export async function uploadEstimate(file:File,signal:AbortSignal):Promise<ImportedEstimate>{
  if(file.size>10*1024*1024)throw new Error('Use a PDF smaller than 10 MB.');
  const response=await fetch('/api/imports/pdf',{method:'POST',headers:{'Content-Type':'application/pdf','X-Estimate-Filename':encodeURIComponent(file.name)},body:file,signal});
  if(response.status===401)window.dispatchEvent(new Event('revive-session-expired'));
  const data=await response.json();if(!response.ok)throw new Error(data.error||'Could not import the PDF.');return data;
}
