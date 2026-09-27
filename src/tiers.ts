// Real Good/Better/Best tiers: each tier carries a warranty, a material grade note and
// concrete scope deltas (lines to add, descriptions to remove) on top of its markup.
// Applying a tier replaces tier-scoped lines and leaves everything else untouched.
import type { JobType, Line, Pricing, TierKey } from './domain';
import { newId } from './domain';

export type { TierKey };
export type TierAddRow = { description: string; quantity?: number; unit?: string; material?: number; hours?: number };
export type ScopeDelta = { add: TierAddRow[]; remove: string[] };
export type TierDefinition = {
  label: string;
  warranty: string;
  materialGrade: string;
  markupPercent: number;
  scopeDeltas: ScopeDelta;
};

export const tierKeys: TierKey[] = ['value', 'standard', 'premium'];
export const tierMarkups: Record<TierKey, number> = { value: 10, standard: 15, premium: 20 };
export const tierLabels: Record<TierKey, string> = { value: 'Value', standard: 'Standard', premium: 'Premium' };

const noDelta: ScopeDelta = { add: [], remove: [] };

export const tierDefinitions: Record<JobType, Record<TierKey, TierDefinition>> = {
  roofing: {
    value: {
      label: 'Value',
      warranty: '5 yr workmanship',
      materialGrade: '3-tab asphalt shingles — builder grade',
      markupPercent: 10,
      scopeDeltas: {
        add: [{ description: '3-tab asphalt shingles (builder grade)', unit: 'sq ft' }],
        remove: ['Architectural asphalt shingles', 'Ice & water shield underlayment', 'Designer shingles', 'Full synthetic underlayment', 'Upgraded ridge vent'],
      },
    },
    standard: {
      label: 'Standard',
      warranty: '10 yr workmanship',
      materialGrade: 'Architectural shingles + ice & water shield',
      markupPercent: 15,
      scopeDeltas: {
        add: [{ description: 'Architectural asphalt shingles', unit: 'sq ft' }, { description: 'Ice & water shield underlayment', unit: 'roll' }],
        remove: ['3-tab asphalt shingles (builder grade)', 'Designer shingles', 'Full synthetic underlayment', 'Upgraded ridge vent'],
      },
    },
    premium: {
      label: 'Premium',
      warranty: '15 yr workmanship + manufacturer',
      materialGrade: 'Designer shingles + full synthetic underlayment + upgraded ridge vent',
      markupPercent: 20,
      scopeDeltas: {
        add: [{ description: 'Designer shingles', unit: 'sq ft' }, { description: 'Full synthetic underlayment', unit: 'sq ft' }, { description: 'Upgraded ridge vent', unit: 'each' }],
        remove: ['3-tab asphalt shingles (builder grade)', 'Architectural asphalt shingles', 'Ice & water shield underlayment'],
      },
    },
  },
  // Non-roofing trades quote by trade line, not by shingle system: tiers still set the
  // margin and warranty story, but carry no scope deltas until a trade needs them.
  renovation: {
    value: { label: 'Value', warranty: '1 yr workmanship', materialGrade: 'Builder-grade finishes', markupPercent: 10, scopeDeltas: noDelta },
    standard: { label: 'Standard', warranty: '2 yr workmanship', materialGrade: 'Mid-grade finishes', markupPercent: 15, scopeDeltas: noDelta },
    premium: { label: 'Premium', warranty: '5 yr workmanship + manufacturer', materialGrade: 'Upgraded finishes', markupPercent: 20, scopeDeltas: noDelta },
  },
  contracting: {
    value: { label: 'Value', warranty: '1 yr workmanship', materialGrade: 'Builder-grade materials', markupPercent: 10, scopeDeltas: noDelta },
    standard: { label: 'Standard', warranty: '2 yr workmanship', materialGrade: 'Mid-grade materials', markupPercent: 15, scopeDeltas: noDelta },
    premium: { label: 'Premium', warranty: '5 yr workmanship + manufacturer', materialGrade: 'Upgraded materials', markupPercent: 20, scopeDeltas: noDelta },
  },
};

export const tierFor = (type: JobType, key: TierKey): TierDefinition => tierDefinitions[type][key];

// Descriptions that belong to any tier of this work type — the scoped set a tier switch manages.
export const tierScopedDescriptions = (type: JobType): Set<string> =>
  new Set(tierKeys.flatMap(key => [...tierDefinitions[type][key].scopeDeltas.add.map(r => r.description), ...tierDefinitions[type][key].scopeDeltas.remove]));

// Applies a tier's scope deltas: removes every tier-scoped line the tier doesn't include
// (plus its explicit removes), adds the tier's rows that aren't already on the quote.
// Adding only absent descriptions makes apply(apply(x)) equal x — idempotent, and line ids
// of untouched lines survive so the portal fingerprint only moves when scope actually moves.
export function applyTier(lines: Line[], type: JobType, key: TierKey, pricing: Pricing): Line[] {
  const def = tierFor(type, key);
  const scoped = tierScopedDescriptions(type);
  const ownAdds = new Set(def.scopeDeltas.add.map(r => r.description));
  const present = new Set(lines.map(l => l.description));
  const kept = lines.filter(l => !scoped.has(l.description) || ownAdds.has(l.description));
  const adds = def.scopeDeltas.add
    .filter(row => !present.has(row.description))
    .map(row => ({ id: newId(), description: row.description, quantity: row.quantity ?? 1, unit: row.unit ?? 'allowance', material: row.material ?? 0, hours: row.hours ?? 0, rate: pricing.laborRate }));
  return [...kept, ...adds];
}
