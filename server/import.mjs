import {Worker} from 'node:worker_threads';
import {createHash} from 'node:crypto';
export const MAX_PDF_BYTES=10*1024*1024;
export function extractPdf(buffer) {
  if(!buffer.length||buffer.length>MAX_PDF_BYTES||buffer.subarray(0,5).toString()!=='%PDF-') throw new Error('Upload a PDF estimate smaller than 10 MB.');
  return new Promise((resolve,reject)=>{
    const worker=new Worker(new URL('./pdf-worker.mjs',import.meta.url),{workerData:buffer,execArgv:process.execArgv.filter(arg=>!arg.startsWith('--input-type')),resourceLimits:{maxOldGenerationSizeMb:128}});
    const timer=setTimeout(()=>{worker.terminate();reject(new Error('PDF reading timed out. Try a smaller text-based estimate.'));},20000);
    worker.once('message',message=>{clearTimeout(timer);worker.terminate();message.error?reject(new Error(message.error)):resolve(message.text);});
    worker.once('error',()=>{clearTimeout(timer);reject(new Error('The PDF could not be read.'));});
    worker.once('exit',code=>{clearTimeout(timer);if(code!==0)reject(new Error('The PDF could not be read.'));});
  });
}
// Monetary information never enters the pricing job, including prices embedded in notes.
export function scopeWithoutPrices(text) {
  return String(text).replace(/(?:USD\s*|\$)\s*\d[\d,]*(?:\.\d{1,2})?/gi,'[imported price omitted]')
    .split('\n').filter(line=>!/^\s*(?:subtotal|total|tax|discount|unit price|amount|price|budget|estimate price)\b/i.test(line))
    .join('\n').trim();
}
export function parseSymplewyse(text,{filename='estimate.pdf',id}={}) {
  const clean=text.replace(/\u0000/g,'-').replace(/\r/g,'').replace(/[ \t]+/g,' ');
  const lines=clean.split('\n').map(l=>l.trim()).filter(Boolean);
  const normalized=lines.join('\n');
  const estimateNumber=normalized.match(/Estimate\s*#\s*(EST[-\s]*[a-z0-9-]+)/i)?.[1]?.replace(/\s+/g,'');
  const section=lines.findIndex(l=>/^(PREPARED FOR|CLIENT)$/i.test(l));
  const project=lines.findIndex(l=>/^PROJECT BREAKDOWN$/i.test(l));
  if(!estimateNumber||section<0||project<=section)throw new Error('The PDF does not match the Symplewyse estimate layout (estimate number, client and project breakdown).');
  const client=lines.slice(section+1,project);
  const email=client.find(l=>/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(l))||'';
  const phone=client.find(l=>/^\+?[\d\s().-]{10,}$/.test(l))||'';
  const address=client.slice(1).filter(l=>l!==email&&l!==phone&&!/Estimate\s*#|Issued|Total\s*\$/i.test(l)).join(', ');
  const end=lines.findIndex((l,i)=>i>project&&/^LINE ITEMS$/i.test(l));
  const notesStart=lines.findIndex(l=>/^NOTES$/i.test(l));
  const notesEnd=lines.findIndex((l,i)=>i>notesStart&&/^(DISCLAIMER|SITE PHOTOS)$/i.test(l));
  const notes=notesStart>=0?lines.slice(notesStart+1,notesEnd>=0?notesEnd:undefined).filter(l=>!/^Page:|^Revive Repair|^\w{3} \d{1,2}, \d{4}/i.test(l)).join('\n'):'';
  const disclaimer=lines.findIndex(l=>/^DISCLAIMER$/i.test(l));
  const photos=lines.findIndex((l,i)=>i>disclaimer&&/^SITE PHOTOS$/i.test(l));
  const sourceTerms=disclaimer>=0?lines.slice(disclaimer+1,photos>=0?photos:undefined).join('\n').slice(0,6000):'';
  const rawScope=lines.slice(project+1,end>=0?end:undefined).join('\n');
  const scope=scopeWithoutPrices(rawScope+(notes?'\n\nNotes\n'+notes:''));
  if(!scope)throw new Error('No project scope could be read. Use a text-based PDF.');
  const amounts=[...normalized.matchAll(/\bTotal\s*\$\s*([\d,]+(?:\.\d{2})?)/gi)].map(m=>Number(m[1].replaceAll(',','')));
  const distinct=[...new Set(amounts)];
  const total=distinct.length===1&&Number.isFinite(distinct[0])?distinct[0]:null;
  const roofing=/\broof(?:ing)?\b|\bTPO\b|\bEPDM\b/i.test(rawScope);
  const type=roofing?'roofing':/\bfloor(?:ing)?\b|\bdrywall\b|\bpartition\b|\brenovat/i.test(rawScope)?'renovation':'contracting';
  const roofWork=/\bcoat(?:ing)?\b|\brestoration\b/i.test(rawScope)?'Coating / restoration':/\breplac/i.test(rawScope)?'Replacement':/\bnew roof|\bnew installation/i.test(rawScope)?'New installation':'Repair';
  const roofSystem=/\bTPO\b|\bPVC\b/i.test(rawScope)?'TPO / PVC membrane':/\bEPDM\b/i.test(rawScope)?'EPDM membrane':/\bmetal roof/i.test(rawScope)?'Metal':/\basphalt|\bshingle/i.test(rawScope)?'Asphalt shingles':'Other / not decided';
  const areaMatch=rawScope.match(/(?:entire\s+|throughout\s+(?:entire\s+)?)?(\d[\d,]*(?:\.\d+)?)\s*(?:sq\.?\s*ft|sqft|square feet)\b/i);
  // A range such as 5,001-10,000 is not a confirmed measurement.
  const range=/\d[\d,]*\s*(?:to|[-–]|\s)\s*\d[\d,]*\s*(?:sq\.?\s*ft|sqft|square feet)/i.test(rawScope);
  const workArea=!roofing&&areaMatch&&!range?Number(areaMatch[1].replaceAll(',','')):null;
  const warnings=['Confirm that the client address is the job site and review the extracted scope.'];
  if(total===null)warnings.push('The imported total was missing or conflicting; confirm it from the original PDF.');
  if(scope.length>12000)warnings.push('Scope exceeds 12,000 characters; review the original PDF for omitted details.');
  if(roofing)warnings.push('PDF roof quantities are scope context only. Google measurement or a confirmed manual roof area is required.');
  return {id:id||createHash('sha256').update(text).digest('hex'),provider:'Symplewyse',filename:String(filename).slice(0,200),estimateNumber,issuedAt:normalized.match(/Issued\s+(.+?)(?:\s+Total|\n)/i)?.[1]||'',total,currency:'USD',customer:client[0]||'',contact:[email,phone].filter(Boolean).join(' · '),address,type,roofWork,roofSystem,workArea,scope:scope.slice(0,12000),sourceTerms,warnings,importedAt:new Date().toISOString(),roofMeasurement:null};
}
export async function prepareImport(buffer,{filename,measureRoof=null}={}) {
  const result=parseSymplewyse(await extractPdf(buffer),{filename,id:createHash('sha256').update(buffer).digest('hex')});
  if(result.type==='roofing')result.roofMeasurement=measureRoof?await measureRoof(result.address):{available:false,reason:'Google roof measurement is not configured. Confirm a manual roof surface area.'};
  return result;
}
export function importJob(source,pricing) {
  const scope=scopeWithoutPrices(source.scope);
  const answers={address:source.address,customer:source.customer,contact:source.contact,title:`${source.estimateNumber} · ${source.type==='roofing'?'Roofing':'Imported project'}`,description:scope.slice(0,6000),notes:scope.slice(6000,12000)};
  if(source.type==='roofing') {
    answers.roofWork=source.roofWork;answers.roofSystem=source.roofSystem;
    if(source.roofMeasurement?.available) {
      answers.roofArea=String(source.roofMeasurement.roofAreaSqFt);
      answers.measurementSource='Google aerial imagery';
      answers.measurementProvenance=JSON.stringify(source.roofMeasurement);
    }
  } else if(source.workArea)answers.workArea=String(source.workArea);
  const area=source.type==='roofing'?Number(answers.roofArea)||null:source.workArea||null;
  return {type:source.type,answers,pricing,area};
}
