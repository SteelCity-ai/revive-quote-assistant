// Pure margin math and approval guardrails. No React, no async — same inputs always
// produce the same output, so Review can trust it without a network round trip.
// The 10% Project Fee is contractual: it belongs to Mike, not to company margin, so it
// is subtracted from the customer price before margin is computed and it is NEVER the
// discount's target (a discount compresses markup, never the fee basis).
import type { Line, Pricing } from './domain';

export const FEE_PERCENT = 10;
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));
const fmt = (n: number) => String(Number(n.toFixed(1)));

export type Margin = {
  internalCost: number; // direct + contingency — what the job costs the company
  customerPrice: number; // what the customer pays: internal cost + markup + tax + fee, minus any discount
  marginDollars: number; // customerPrice − tax − fee − internalCost (fee stays out of company margin)
  marginPercent: number; // marginDollars as a share of customerPrice
  preDiscountTotal: number; // customer price before any discount
  discountDollars: number; // discount actually taken (capped at markup — a discount can never undercut cost)
  markup: number; // markup after discount
};

export function computeMargin(lines: Line[], pricing: Pricing, feePercent = FEE_PERCENT, discountPercent = 0): Margin {
  const materials = round(lines.reduce((s, l) => s + round(l.quantity * l.material), 0));
  const labor = round(lines.reduce((s, l) => s + round(l.hours * l.rate), 0));
  const direct = round(materials + labor);
  const contingency = round(direct * pricing.contingency / 100);
  const markup = round((direct + contingency) * pricing.markup / 100);
  const tax = round(materials * pricing.tax / 100);
  const fee = round(direct * feePercent / 100); // Project Fee — basis is always direct cost, never discounted
  const internalCost = round(direct + contingency);
  const preDiscountTotal = round(internalCost + markup + tax + fee);
  const discountDollars = round(Math.min(preDiscountTotal * clamp(discountPercent, 0, 100) / 100, markup));
  const customerPrice = round(preDiscountTotal - discountDollars);
  const marginDollars = round(customerPrice - tax - fee - internalCost);
  return {
    internalCost, customerPrice, marginDollars,
    marginPercent: customerPrice > 0 ? round(marginDollars / customerPrice * 100) : 0,
    preDiscountTotal, discountDollars, markup: round(markup - discountDollars),
  };
}

// Document totals with the discount applied: identical shape to domain.totals(), but the
// markup (and therefore the total) carries the discount while fee, tax and direct stay put.
export function discountedTotals(lines: Line[], pricing: Pricing, discountPercent = 0, feePercent = FEE_PERCENT) {
  const base = computeMargin(lines, pricing, feePercent, discountPercent);
  const materials = round(lines.reduce((s, l) => s + round(l.quantity * l.material), 0));
  const labor = round(lines.reduce((s, l) => s + round(l.hours * l.rate), 0));
  const direct = round(materials + labor);
  return {
    materials, labor, direct,
    contingency: round(direct * pricing.contingency / 100),
    markup: base.markup, tax: round(materials * pricing.tax / 100), fee: round(direct * feePercent / 100),
    discount: base.discountDollars,
    total: base.customerPrice,
  };
}

export type GuardrailConfig = { minMarginPercent: number; maxDiscountPercent: number; warnBelowContingencyPercent: number };
export const guardrailDefaults: GuardrailConfig = { minMarginPercent: 18, maxDiscountPercent: 10, warnBelowContingencyPercent: 5 };
// Context the margin object alone can't carry: the applied discount and contingency setting.
export type GuardrailTiers = { discountPercent?: number; contingencyPercent?: number };
export type Guardrails = { ok: boolean; warnings: string[]; requiresApproval: boolean };

export function evaluateGuardrails(config: GuardrailConfig, margin: Pick<Margin, 'marginPercent'>, tiers?: GuardrailTiers): Guardrails {
  const warnings: string[] = [];
  const below = margin.marginPercent < config.minMarginPercent;
  if (below) warnings.push(`Margin ${fmt(margin.marginPercent)}% is below the ${config.minMarginPercent}% minimum`);
  const discount = tiers?.discountPercent ?? 0;
  const overDiscount = discount > config.maxDiscountPercent;
  if (overDiscount) warnings.push(`Discount ${fmt(discount)}% exceeds the ${config.maxDiscountPercent}% maximum`);
  const contingency = tiers?.contingencyPercent;
  if (contingency != null && contingency < config.warnBelowContingencyPercent) warnings.push(`Contingency ${fmt(contingency)}% is below the ${config.warnBelowContingencyPercent}% recommendation`);
  return { ok: warnings.length === 0, warnings, requiresApproval: below || overDiscount };
}
