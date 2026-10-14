import {it,expect} from 'vitest';
import {parseSymplewyse,prepareImport,importJob,scopeWithoutPrices,extractPdf} from './import.mjs';
const sample=(total='12,345.67')=>`Example Contractor\n100 Vendor Rd\nEstimate #EST-test123 Issued Oct 13, 2026 Total $${total} Pending\nPREPARED FOR\nTest Client\n123 Test Street\nTest City, PA 17011\nclient@example.com\n+1 (717) 555-0100\nPROJECT BREAKDOWN\nRoof Repair and Coating\nRepair TPO roof, 5,001 to 10,000 sq ft, and seal 11 to 20 penetrations.\nLINE ITEMS\nSubtotal $${total}\nTotal $${total}\nNOTES\nRepair option $5,000; full coating $12,000. Product warranty 15 years.\nDISCLAIMER\nValid for 30 days.\nSITE PHOTOS`;
// Minimal synthetic PDF: real customer documents never become committed fixtures.
function pdf(text){const stream='BT /F1 10 Tf 40 760 Td '+text.split('\n').map((line,i)=>(i?'0 -14 Td ':'')+'('+line.replaceAll('\\','\\\\').replaceAll('(','\\(').replaceAll(')','\\)')+') Tj').join('\n')+' ET';const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];let file='%PDF-1.4\n';const offsets=[0];objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(file));file+=`${i+1} 0 obj\n${object}\nendobj\n`;});const xref=Buffer.byteLength(file);file+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;return Buffer.from(file);}
it('extracts client site instead of vendor, preserves total separately and excludes note prices',()=>{
  const result=parseSymplewyse(sample());expect(result.estimateNumber).toBe('EST-test123');expect(result.issuedAt).toBe('Oct 13, 2026');expect(result.address).toBe('123 Test Street, Test City, PA 17011');expect(result.customer).toBe('Test Client');expect(result.contact).toContain('client@example.com');expect(result.total).toBe(12345.67);expect(result.type).toBe('roofing');expect(result.roofWork).toBe('Coating / restoration');expect(result.scope).toContain('15 years');expect(result.scope).not.toMatch(/5,000|12,000|12,345|\$/);expect(result.sourceTerms).toBe('Valid for 30 days.');expect(result.workArea).toBeNull();
});
it('makes identical pricing inputs when original prices change',()=>{
  const pricing={laborRate:0,markup:15,contingency:0,tax:0};const a=parseSymplewyse(sample()),b=parseSymplewyse(sample('999,999.99'));
  for(const source of [a,b])source.roofMeasurement={available:true,roofAreaSqFt:8500,partial:false};
  const job=importJob(a,pricing);expect(job).toEqual(importJob(b,pricing));expect(job.area).toBe(8500);expect(job.answers.roofArea).toBe('8500');expect(JSON.stringify(job)).not.toContain('12345');expect(job).not.toHaveProperty('total');
});
it('rejects unmatched layouts, conflicting totals, and monetary lines',()=>{
  expect(()=>parseSymplewyse('unrelated invoice')).toThrow();expect(parseSymplewyse(sample()+'\nTotal $1,000.00').total).toBeNull();expect(scopeWithoutPrices('Roof area 9000 sq ft\nBudget 80000\nTotal 123\nUSD 5000')).not.toMatch(/80000|123|5000/);
});
it('reads a real synthetic PDF and calls Google measurement with the imported site address',async()=>{
  let address;const source=await prepareImport(pdf(sample()),{filename:'test.pdf',measureRoof:async a=>{address=a;return {available:true,roofAreaSqFt:8000,partial:true,coveragePercent:80};}});
  expect(address).toBe('123 Test Street, Test City, PA 17011');expect(source.total).toBe(12345.67);expect(source.roofMeasurement.partial).toBe(true);expect(source.roofMeasurement.roofAreaSqFt).toBe(8000);
});
it('rejects non-PDF and oversized files before launching the parser',()=>{
  expect(()=>extractPdf(Buffer.from('not pdf'))).toThrow();expect(()=>extractPdf(Buffer.alloc(10*1024*1024+1))).toThrow();
});
