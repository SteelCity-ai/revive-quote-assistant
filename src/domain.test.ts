import { describe, expect, it } from 'vitest';
import { defaults, derivedTitle, initialLines, issues, makeQuote, questions, roofMeasurement, totals, validAnswer } from './domain';
import type { Line } from './domain';
describe('guided questions', () => {
  it('asks only the selected trades and updates when the selection changes', () => {
    const first = questions('renovation', { trades: ['Electrical', 'Flooring'] });
    expect(first.some(q => q.id === 'trade:Electrical')).toBe(true);
    expect(first.some(q => q.id === 'trade:Plumbing')).toBe(false);
    expect(questions('contracting', { trades: ['Plumbing'] }).some(q => q.id === 'trade:Electrical')).toBe(false);
  });
  it('keeps the roofing intake to the basics: customer, address, work, system, area', () => {
    expect(questions('roofing', {}).map(q => q.id)).toEqual(['customer', 'address', 'roofWork', 'roofSystem', 'roofArea']);
    expect(questions('roofing', {}).map(q => q.id)).not.toContain('title'); // project name is derived
  });
  it('does not turn unknown or blank measurements into valid numbers', () => {
    const area = questions('roofing', {}).find(q => q.id === 'roofArea')!;
    expect(validAnswer(area, '')).toBe(false); expect(validAnswer(area, '0')).toBe(false);
    expect(validAnswer(area, '-50')).toBe(false); expect(validAnswer(area, 'Not sure yet')).toBe(true);
  });
});
describe('roof quantities', () => {
  it('adjusts footprint for pitch, then adds waste only to materials', () => {
    const quote = makeQuote('roofing', defaults);
    quote.answers = { measurementMode: 'Building footprint + roof pitch', roofArea: '1200', pitch: '6', waste: '10', roofWork: 'Replacement', layers: '1 layer' };
    const m = roofMeasurement(quote.answers);
    expect(m.area).toBeCloseTo(1341.6407865);
    expect(m.materialArea).toBeCloseTo(1475.8048651);
    const lines = initialLines(quote);
    expect(lines[0].quantity).toBe(1476);
    expect(lines.find(l => l.description === 'Tear-off & disposal')?.quantity).toBe(1342);
    expect(lines.every(l => l.material === 0 && l.hours === 0)).toBe(true);
  });
  it('never applies pitch twice to measured surface areas', () => {
    expect(roofMeasurement({ measurementMode: 'Measured roof surface area', roofArea: '1200', pitch: '12', waste: '0' }).area).toBe(1200);
  });
  it('preserves unknowns and ignores stale roof measurements when method is unknown', () => {
    expect(roofMeasurement({ measurementMode: 'Not sure yet', roofArea: '900', waste: '0' }).area).toBeNull();
    expect(roofMeasurement({ measurementMode: 'Building footprint + roof pitch', roofArea: '900', pitch: 'Not sure yet', waste: '0' }).area).toBeNull();
    expect(roofMeasurement({ measurementMode: 'Measured roof surface area', roofArea: '900', waste: 'Not sure yet' }).materialArea).toBeNull();
  });
});
describe('pricing and review', () => {
  it('derives the project name from address and work type', () => {
    const quote = makeQuote('roofing', defaults);
    quote.answers = { address: '123 High St, Harrisburg, PA 17101', roofWork: 'Repair' };
    expect(derivedTitle(quote)).toBe('123 High St roof repair');
    quote.answers.title = 'Custom name';
    expect(derivedTitle(quote)).toBe('Custom name');
  });
  it('uses total labor hours rather than multiplying labor by quantity', () => {
    const lines: Line[] = [{ id: '1', description: 'Work', quantity: 10, unit: 'each', material: 20, hours: 4, rate: 50 }];
    expect(totals(lines, { laborRate: 50, contingency: 10, markup: 15, tax: 6 })).toEqual({ materials: 200, labor: 200, direct: 400, contingency: 40, markup: 66, tax: 12, fee: 40, total: 558 });
  });
  it('flags zero-price lines and missing fixed quote terms', () => {
    const quote = makeQuote('contracting', defaults); quote.kind = 'fixed';
    quote.lines = [{ id: 'a', description: 'Demo', quantity: 1, unit: 'allowance', material: 0, hours: 0, rate: 0 }];
    expect(issues(quote)).toContain('Check quantity and pricing: Demo');
    expect(issues(quote)).toContain('Fixed quotes need terms and an explicit exclusions statement.');
  });
  it('new quotes snapshot defaults so changes do not reprice old jobs', () => {
    const pricing = { ...defaults, laborRate: 75 }; const quote = makeQuote('renovation', pricing);
    pricing.laborRate = 90; expect(quote.pricing.laborRate).toBe(75);
  });
});
