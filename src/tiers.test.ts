import { describe, expect, it } from 'vitest';
import { applyTier, tierDefinitions, tierFor, tierMarkups, tierScopedDescriptions } from './tiers';
import { defaults } from './domain';
import type { Line } from './domain';

const line = (id: string, description: string, quantity = 1, material = 10): Line => ({ id, description, quantity, unit: 'each', material, hours: 0, rate: 50 });
const tearOff = line('t1', 'Tear-off & disposal', 1200, 0.5);
const flashing = line('f1', 'Flashing, edges & roof details', 1, 250);

describe('roofing tier definitions', () => {
  it('carries the Good/Better/Best warranty and material story', () => {
    expect(tierFor('roofing', 'value')).toMatchObject({ warranty: '5 yr workmanship', materialGrade: expect.stringContaining('3-tab') });
    expect(tierFor('roofing', 'standard')).toMatchObject({ warranty: '10 yr workmanship', materialGrade: expect.stringContaining('ice & water shield') });
    expect(tierFor('roofing', 'premium')).toMatchObject({ warranty: expect.stringContaining('15 yr'), materialGrade: expect.stringContaining('Designer shingles') });
  });

  it('keeps the tier markups at 10 / 15 / 20 for every work type', () => {
    for (const type of ['roofing', 'renovation', 'contracting'] as const) {
      expect(tierMarkups).toEqual({ value: 10, standard: 15, premium: 20 });
      expect(tierDefinitions[type].standard.scopeDeltas).toBeDefined();
    }
  });
});

describe('applyTier', () => {
  it('adds the tier rows and removes the other tiers’ scoped lines, leaving the rest untouched', () => {
    const lines = [tearOff, flashing, line('a1', 'Architectural asphalt shingles', 1500, 1.4)];
    const result = applyTier(lines, 'roofing', 'premium', defaults);
    const descriptions = result.map(l => l.description);
    expect(descriptions).toContain('Designer shingles');
    expect(descriptions).toContain('Full synthetic underlayment');
    expect(descriptions).toContain('Upgraded ridge vent');
    expect(descriptions).not.toContain('Architectural asphalt shingles');
    expect(result.find(l => l.id === 't1')).toEqual(tearOff); // other lines keep id, quantity, pricing
    expect(result.find(l => l.id === 'f1')).toEqual(flashing);
  });

  it('is idempotent: applying the same tier twice changes nothing', () => {
    const lines = [tearOff, line('v1', '3-tab asphalt shingles (builder grade)', 1500, 0.9)];
    const once = applyTier(lines, 'roofing', 'value', defaults);
    expect(applyTier(once, 'roofing', 'value', defaults)).toEqual(once);
  });

  it('switches tiers cleanly with no leftover or duplicate scoped lines', () => {
    const value = applyTier([tearOff], 'roofing', 'value', defaults);
    const standard = applyTier(value, 'roofing', 'standard', defaults);
    const premium = applyTier(standard, 'roofing', 'premium', defaults);
    for (const step of [standard, premium]) {
      const scoped = step.filter(l => tierScopedDescriptions('roofing').has(l.description)).map(l => l.description).sort();
      expect(new Set(scoped).size).toBe(scoped.length); // no duplicates
    }
    expect(premium.map(l => l.description)).toEqual(expect.arrayContaining(['Designer shingles', 'Tear-off & disposal']));
    expect(premium.map(l => l.description)).not.toContain('3-tab asphalt shingles (builder grade)');
  });

  it('prices added tier rows at the quote’s labor rate so they stay editable lines', () => {
    const pricing = { ...defaults, laborRate: 85 };
    const result = applyTier([tearOff], 'roofing', 'standard', pricing);
    const shingles = result.find(l => l.description === 'Architectural asphalt shingles')!;
    expect(shingles.rate).toBe(85);
    expect(shingles).toMatchObject({ quantity: 1, unit: 'sq ft', material: 0, hours: 0 });
  });
});
