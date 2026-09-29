import { describe, expect, it } from 'vitest';
import { defaults, derivedTitle, initialLines, issues, makeQuote, questions, roofMeasurement, totals, validAnswer } from './domain';
import type { Line } from './domain';
import { approvalFingerprint } from './portal';
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

  describe('priced labor lines and end-of-flow line editing', () => {
    const labor: Line = { id: 'l-labor', description: 'Tear-off crew', quantity: 1, unit: 'hr', material: 0, hours: 8, rate: 65 };
    it('a labor line is priced labor, not an allowance — hours x rate flows into labor and fee stays 10% of direct', () => {
      const t = totals([labor], { ...defaults, laborRate: 65 });
      expect(t.labor).toBe(520);
      expect(t.direct).toBe(520);
      expect(t.fee).toBe(52); // 10% of direct — unchanged by labor composition
      expect(t.total).toBe(t.direct + t.markup + t.fee + t.tax);
    });
    it('a labor line is not counted as an allowance', () => {
      const allowance: Line = { id: 'l-allow', description: 'X', quantity: 1, unit: 'allowance', material: 100, hours: 0, rate: 65 };
      const allowanceOnly = [allowance].filter(l => l.unit === 'allowance');
      expect(allowanceOnly).toHaveLength(1);
      expect([labor].filter(l => l.unit === 'allowance')).toHaveLength(0);
    });
    it('an exclusion line contributes nothing to totals', () => {
      const exclusion: Line = { id: 'l-excl', description: 'Landscaping repair', quantity: 1, unit: 'exclusion', material: 0, hours: 0, rate: 65 };
      const before = totals([labor], { ...defaults, laborRate: 65 });
      const after = totals([labor, exclusion], { ...defaults, laborRate: 65 });
      expect(after.total).toBe(before.total);
    });
    it('editing a line description or rate changes the fingerprint, so a saved portal link requires a new revision', () => {
      const q1 = { ...makeQuote('roofing', { ...defaults, laborRate: 65 }), lines: [{ id: 'l1', description: 'Materials', quantity: 1, unit: 'allowance', material: 100, hours: 2, rate: 65 }] };
      const f1 = approvalFingerprint(q1);
      const q2 = { ...q1, lines: [{ ...q1.lines[0], description: 'Reworded line' }] };
      const q3 = { ...q1, lines: [{ ...q1.lines[0], hours: q1.lines[0].hours + 2 }] };
      expect(approvalFingerprint(q2)).not.toBe(f1);
      expect(approvalFingerprint(q3)).not.toBe(f1);
    });
  });
});
