import { describe, expect, it } from 'vitest';
import { confidence, googleCoverageFromAnswers, lineCost } from './confidence';
import type { Line } from './domain';

const line = (over: Partial<Line> = {}): Line => ({ id: over.id ?? 'l1', description: 'Line', quantity: 1, unit: 'each', material: 0, hours: 0, rate: 0, ...over });
const concreteAnswers = { customer: 'Pat', address: '1 Main St, Harrisburg, PA 17101', roofWork: 'Replacement', roofSystem: 'TPO / PVC membrane', roofArea: '2000' };
const researched = { low: 9000, high: 14000, basis: 'local cost guides' };
type Case = { name: string; answers?: Record<string, string | string[]>; lines?: Line[]; marketRange?: typeof researched | null; googleCoverage?: number | null; totals?: { direct: number }; expect: { overall?: number; siteVisitRequired?: boolean; domains?: Record<string, string>; drivers?: { questionId: string; domain: string; impact: string }[] } };
const cases: Case[] = [
  {
    name: 'allowance cost is excluded from the confirmed share',
    lines: [line({ description: 'Membrane', quantity: 20, unit: 'sq ft', material: 40 }), line({ id: 'l2', description: 'Details', unit: 'allowance', material: 200 })],
    googleCoverage: 1, marketRange: researched,
    expect: { overall: 80, siteVisitRequired: false, domains: { materials: 'allowance', labor: 'confirmed', quantities: 'confirmed', scope: 'confirmed', pricing: 'confirmed' } },
  },
  {
    name: 'allowance labor cost also counts as unconfirmed',
    lines: [line({ description: 'Labor', quantity: 1, unit: 'allowance', hours: 1, rate: 100 }), line({ id: 'l2', description: 'Parts', quantity: 5, unit: 'each', material: 60 })],
    googleCoverage: 1, marketRange: researched,
    expect: { overall: 75, domains: { labor: 'allowance', materials: 'confirmed' } },
  },
  {
    name: 'coverage exactly 0.64 keeps quantities approximate',
    lines: [line({ quantity: 10, material: 10 })], googleCoverage: 0.64, marketRange: researched,
    expect: { domains: { quantities: 'approximate' } },
  },
  {
    name: 'coverage just under 0.64 makes quantities an allowance',
    lines: [line({ quantity: 10, material: 10 })], googleCoverage: 0.6399, marketRange: researched,
    expect: { domains: { quantities: 'allowance' } },
  },
  {
    name: 'no measured area recorded makes quantities an allowance even with full coverage',
    answers: { ...concreteAnswers, roofArea: 'Not sure yet' }, lines: [line({ quantity: 10, material: 10 })], googleCoverage: 1, marketRange: researched,
    expect: { domains: { quantities: 'allowance' } },
  },
  {
    name: 'each Not sure yet answer becomes a driver; area questions are quantity drivers',
    answers: { ...concreteAnswers, roofSystem: 'Not sure yet', roofArea: 'Not sure yet' }, lines: [line({ quantity: 10, material: 10 })], googleCoverage: 1, marketRange: researched,
    expect: {
      domains: { scope: 'approximate', quantities: 'allowance' },
      drivers: [
        { questionId: 'roofSystem', domain: 'scope', impact: 'high' },
        { questionId: 'roofArea', domain: 'quantities', impact: 'high' },
      ],
    },
  },
  {
    name: 'secondary unknowns are medium-impact scope drivers',
    answers: { ...concreteAnswers, roofWork: 'Not sure yet' }, lines: [line({ quantity: 10, material: 10 })], googleCoverage: 1, marketRange: researched,
    expect: { drivers: [{ questionId: 'roofWork', domain: 'scope', impact: 'medium' }] },
  },
  {
    name: 'overall exactly 70 does not require a site visit',
    lines: [line({ quantity: 7, material: 100 }), line({ id: 'l2', description: 'Allowance', unit: 'allowance', material: 300 })],
    googleCoverage: 1, marketRange: researched,
    expect: { overall: 70, siteVisitRequired: false },
  },
  {
    name: 'overall below 70 requires a site visit',
    lines: [line({ quantity: 69, material: 10 }), line({ id: 'l2', description: 'Allowance', unit: 'allowance', material: 310 })],
    googleCoverage: 1, marketRange: researched,
    expect: { overall: 69, siteVisitRequired: true },
  },
  {
    name: 'unknown research spread keeps pricing approximate',
    lines: [line({ quantity: 10, material: 10 })], googleCoverage: 1, marketRange: null,
    expect: { domains: { pricing: 'approximate' } },
  },
  {
    name: 'concrete answers, full coverage and no allowances score 100 across the board',
    lines: [line({ quantity: 10, material: 100 }), line({ id: 'l2', description: 'Labor', quantity: 1, unit: 'hrs', hours: 8, rate: 75 })],
    googleCoverage: 1, marketRange: researched,
    expect: { overall: 100, siteVisitRequired: false, domains: { scope: 'confirmed', quantities: 'confirmed', materials: 'confirmed', labor: 'confirmed', pricing: 'confirmed' }, drivers: [] },
  },
  {
    name: 'totals direct is used as the denominator when supplied',
    lines: [line({ quantity: 8, material: 100 }), line({ id: 'l2', description: 'Allowance', unit: 'allowance', material: 200 })],
    totals: { direct: 1000 }, googleCoverage: 1, marketRange: researched,
    expect: { overall: 80 },
  },
];
describe('confidence scorer', () => {
  for (const c of cases) it(c.name, () => {
    const result = confidence({ type: 'roofing', answers: { ...concreteAnswers, ...c.answers }, lines: c.lines ?? [], marketRange: c.marketRange as never, googleCoverage: c.googleCoverage ?? null, totals: c.totals });
    if (c.expect.overall !== undefined) expect(result.overall).toBe(c.expect.overall);
    if (c.expect.siteVisitRequired !== undefined) expect(result.siteVisitRequired).toBe(c.expect.siteVisitRequired);
    for (const [domain, level] of Object.entries(c.expect.domains ?? {})) expect(result.domains[domain as keyof typeof result.domains], domain).toBe(level);
    if (c.expect.drivers) expect(result.materialDrivers.map(d => ({ questionId: d.questionId, domain: d.domain, impact: d.impact }))).toEqual(c.expect.drivers);
  });
  it('falls back to coverage recorded with the confirmed measurement', () => {
    expect(googleCoverageFromAnswers({ measurementCoverage: '72' })).toBe(0.72);
    expect(googleCoverageFromAnswers({})).toBeNull();
    expect(googleCoverageFromAnswers({ measurementCoverage: '150' })).toBeNull();
    const result = confidence({ type: 'roofing', answers: { ...concreteAnswers, measurementCoverage: '50' }, lines: [line({ quantity: 1, material: 1 })] });
    expect(result.domains.quantities).toBe('allowance');
  });
  it('driver labels come from the question text and every driver matches a Not sure answer', () => {
    const result = confidence({ type: 'roofing', answers: { ...concreteAnswers, roofSystem: 'Not sure yet' }, lines: [line({ quantity: 1, material: 1 })], marketRange: researched });
    expect(result.materialDrivers).toEqual([{ questionId: 'roofSystem', label: 'What roof system are we quoting?', domain: 'scope', impact: 'high' }]);
  });
  it('lineCost matches the quote total math', () => {
    expect(lineCost(line({ quantity: 3, material: 25, hours: 2, rate: 40 }))).toBe(155);
  });
});
