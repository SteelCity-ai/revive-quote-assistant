import {it,expect} from 'vitest';
import {quoteFromImport,pricingScope} from './import';
import type {ImportedEstimate} from './import';
import {defaults,totals} from './domain';
const source={id:'a'.repeat(64),provider:'Symplewyse',filename:'test.pdf',estimateNumber:'EST-test',issuedAt:'Oct 13, 2026',total:99999,currency:'USD',customer:'Test',contact:'test@example.com',address:'123 Test Street',type:'roofing',roofWork:'Repair',roofSystem:'TPO / PVC membrane',workArea:null,scope:'Repair 3000 sq ft roof. Option $99999.',warnings:[],importedAt:'2026-10-13T00:00:00Z',roofMeasurement:{available:true,roofAreaSqFt:3000}} as ImportedEstimate;
it('keeps imported price outside money calculations and research answers',()=>{
  const quote=quoteFromImport(source,defaults,3000);expect(quote.sourceImport?.total).toBe(99999);expect(quote.lines).toEqual([]);expect(totals(quote.lines,quote.pricing).total).toBe(0);expect(JSON.stringify(quote.answers)).not.toContain('99999');expect(quote.answers.roofArea).toBe('3000');expect(quote.approvedAt).toBeUndefined();expect(quote.acknowledged).toBe(false);
});
it('does not silently turn a PDF roof range into a measured roof quantity',()=>{
  const quote=quoteFromImport(source,defaults);expect(quote.answers.roofArea).toBeUndefined();expect(pricingScope('Scope\nTotal 99999\nBudget 45000')).toBe('Scope');
});
