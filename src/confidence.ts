// Deterministic estimate-confidence scorer. No AI calls, no async — same inputs always
// produce the same output, so the Review page can trust it without a network round trip.
import type { Answers, JobType, Line } from './domain';
import { questions, roofMeasurement } from './domain';

export type ConfidenceDomain = 'scope' | 'quantities' | 'materials' | 'labor' | 'pricing';
export type ConfidenceLevel = 'confirmed' | 'approximate' | 'allowance';
export type MaterialDriver = { questionId: string; label: string; domain: ConfidenceDomain; impact: 'high' | 'medium' };
export type Confidence = {
  overall: number; // 0-100: share of DIRECT cost backed by confirmed (non-allowance) lines
  domains: Record<ConfidenceDomain, ConfidenceLevel>;
  siteVisitRequired: boolean; // overall < 70 — advisory only, saving is never blocked
  materialDrivers: MaterialDriver[]; // every 'Not sure yet' answer that could move the total
};
export type ConfidenceInput = {
  type: JobType;
  answers: Answers;
  lines: Line[];
  totals?: { direct: number }; // optional precomputed denominator; recomputed from lines otherwise
  marketRange?: { low: number; high: number; basis: string } | null; // researched spread (AIReport.marketRange)
  googleCoverage?: number | null; // 0-1 Solar imagery coverage; falls back to answers.measurementCoverage
};

export const lineCost = (l: Line): number => l.quantity * l.material + l.hours * l.rate;
export const googleCoverageFromAnswers = (a: Answers): number | null => {
  const n = Number(a.measurementCoverage);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n / 100 : null;
};
const QUANTITY_QUESTIONS = new Set(['measurementMode', 'roofArea', 'workArea', 'pitch', 'waste']);
const HIGH_IMPACT = new Set(['measurementMode', 'roofArea', 'workArea', 'roofSystem']);

export function confidence(input: ConfidenceInput): Confidence {
  const { type, answers, lines } = input;
  const coverage = input.googleCoverage != null && input.googleCoverage >= 0 && input.googleCoverage <= 1
    ? input.googleCoverage
    : googleCoverageFromAnswers(answers);
  const direct = input.totals && input.totals.direct > 0 ? input.totals.direct : lines.reduce((s, l) => s + lineCost(l), 0);
  const allowanceCost = lines.filter(l => l.unit === 'allowance').reduce((s, l) => s + lineCost(l), 0);
  const confirmed = Math.max(0, direct - allowanceCost);
  const overall = direct > 0 ? Math.round((confirmed / direct) * 100) : lines.some(l => l.unit === 'allowance') ? 0 : 100;
  const measured = roofMeasurement(answers).area ?? (Number(answers.workArea) > 0 ? Number(answers.workArea) : null);
  const quantities: ConfidenceLevel = measured == null ? 'allowance'
    : coverage != null && coverage < 0.64 ? 'allowance'
    : coverage != null && coverage < 1 ? 'approximate'
    : 'confirmed';
  const materials: ConfidenceLevel = lines.some(l => l.unit === 'allowance' && l.quantity * l.material > 0) ? 'allowance' : 'confirmed';
  const labor: ConfidenceLevel = lines.some(l => l.unit === 'allowance' && l.hours * l.rate > 0) ? 'allowance' : 'confirmed';
  // Pricing is only 'confirmed' when the tier is chosen against a researched local spread; without
  // research the tier (and therefore the margin) is a judgment call, not evidence.
  const pricing: ConfidenceLevel = input.marketRange ? 'confirmed' : 'approximate';
  const unsure = questions(type, answers).filter(q => answers[q.id] === 'Not sure yet');
  const scope: ConfidenceLevel = unsure.length ? 'approximate' : 'confirmed';
  const materialDrivers: MaterialDriver[] = unsure.map(q => ({
    questionId: q.id,
    label: q.title,
    domain: QUANTITY_QUESTIONS.has(q.id) ? 'quantities' : 'scope',
    impact: HIGH_IMPACT.has(q.id) ? 'high' : 'medium',
  }));
  return { overall, domains: { scope, quantities, materials, labor, pricing }, siteVisitRequired: overall < 70, materialDrivers };
}
