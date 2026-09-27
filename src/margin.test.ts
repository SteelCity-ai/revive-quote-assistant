import { describe, expect, it } from 'vitest';
import { computeMargin, discountedTotals, evaluateGuardrails, guardrailDefaults } from './margin';
import { totals } from './domain';
import type { Line, Pricing } from './domain';

const pricing: Pricing = { laborRate: 50, markup: 15, contingency: 0, tax: 0 };
const line = (material: number, hours: number): Line => ({ id: 'l1', description: 'Work', quantity: 1, unit: 'each', material, hours, rate: 50 });

describe('computeMargin', () => {
  // Table: direct 1000 → markup 150, tax 0, fee 100. Fee is Mike's, so it is excluded from margin.
  it.each([
    ['no discount', pricing, 0, { internalCost: 1000, customerPrice: 1250, marginDollars: 150, marginPercent: 12 }],
    ['10% discount comes out of markup only', pricing, 10, { internalCost: 1000, customerPrice: 1125, marginDollars: 25, marginPercent: 2.22 }],
    ['discount can never undercut cost (capped at markup)', pricing, 50, { internalCost: 1000, customerPrice: 1100, marginDollars: 0, marginPercent: 0 }],
  ])('%s', (_name, p, discount, expected) => {
    const m = computeMargin([line(600, 8)], p, 10, discount); // direct = 600 + 8*50 = 1000
    expect(m).toMatchObject(expected);
  });

  it('keeps the fee basis on direct cost even under a discount', () => {
    const m = computeMargin([line(600, 8)], pricing, 10, 10);
    expect(m.preDiscountTotal - m.customerPrice).toBe(125); // 10% of the 1250 pre-discount price
    const dt = discountedTotals([line(600, 8)], pricing, 10);
    expect(dt.fee).toBe(100); // 10% of 1000 direct — unchanged by the discount
    expect(dt.discount).toBe(125);
    expect(dt.total).toBe(1125);
  });

  it('agrees with domain.totals at zero discount and the default 10% fee', () => {
    const lines = [line(600, 8), { ...line(0, 2), id: 'l2', description: 'Labor', quantity: 3, unit: 'hrs', material: 0, hours: 2, rate: 50 }];
    const t = totals(lines, { ...pricing, contingency: 10, tax: 6 });
    const m = computeMargin(lines, { ...pricing, contingency: 10, tax: 6 });
    expect(m.customerPrice).toBe(t.total);
    expect(m.internalCost).toBe(t.direct + t.contingency);
    expect(m.marginDollars).toBe(t.total - t.tax - t.fee - (t.direct + t.contingency));
  });

  it('counts contingency as internal cost and keeps it out of margin', () => {
    const m = computeMargin([line(1000, 0)], { ...pricing, contingency: 10 }); // direct 1000, contingency 100, markup 165
    expect(m.internalCost).toBe(1100);
    expect(m.marginDollars).toBe(165);
  });
});

describe('evaluateGuardrails', () => {
  const margin = (percent: number) => ({ marginPercent: percent });
  it.each([
    ['18.0% is exactly at the minimum — ok', 18, undefined, { ok: true, warnings: [], requiresApproval: false }],
    ['17.9% is below the 18% minimum — warn + approval', 17.9, undefined, { ok: false, warnings: ['Margin 17.9% is below the 18% minimum'], requiresApproval: true }],
    ['5% is well below — warn + approval', 5, undefined, { ok: false, warnings: ['Margin 5% is below the 18% minimum'], requiresApproval: true }],
    ['19% is fine', 19, undefined, { ok: true, warnings: [], requiresApproval: false }],
    ['10% discount is exactly at the max — ok', 20, 10, { ok: true, warnings: [], requiresApproval: false }],
    ['10.5% discount exceeds the max — approval required', 20, 10.5, { ok: false, warnings: ['Discount 10.5% exceeds the 10% maximum'], requiresApproval: true }],
  ])('%s', (_name, percent, discount, expected) => {
    expect(evaluateGuardrails(guardrailDefaults, margin(percent), { discountPercent: discount, contingencyPercent: 8 })).toEqual(expected);
  });

  it('warns — but does not lock approval — when contingency falls below the recommendation', () => {
    const g = evaluateGuardrails(guardrailDefaults, { marginPercent: 20 }, { discountPercent: 0, contingencyPercent: 4 });
    expect(g.warnings).toEqual(['Contingency 4% is below the 5% recommendation']);
    expect(g.requiresApproval).toBe(false);
    expect(g.ok).toBe(false);
  });

  it('flags both a low margin and an over-limit discount for approval', () => {
    const g = evaluateGuardrails(guardrailDefaults, { marginPercent: 12 }, { discountPercent: 15, contingencyPercent: 5 });
    expect(g.warnings).toEqual(['Margin 12% is below the 18% minimum', 'Discount 15% exceeds the 10% maximum']);
    expect(g.requiresApproval).toBe(true);
  });
});
