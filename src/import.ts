import { newId } from './domain';
import type { Quote, Pricing, Line, JobType, Answers, TierKey } from './domain';
import type { SavedState } from './storage';
import { computeMargin } from './margin';

// Strict draft import: parse/validate only at parse time, write exactly once at commit.
// Never trusts imported totals or execution metadata; recomputes through existing math.

const MAX_PAYLOAD_CHARS = 2 * 1024 * 1024; // 2 MiB payload cap
const MAX_QUOTES = 100;
const MAX_LINES_PER_QUOTE = 500;
const MAX_ANSWER_ENTRIES = 200;
const MAX_ANSWER_KEY_CHARS = 120;
const MAX_ANSWER_VALUE_CHARS = 10_000;
const MAX_ANSWER_ARRAY_ITEMS = 50;
const MAX_TEXT_CHARS = 100_000;
const MAX_LINE_DESCRIPTION_CHARS = 500;
const MAX_UNIT_CHARS = 60;
const MAX_MONEY = 1e12; // documented dollar cap: keep cents arithmetic exact and reject absurd aggregates

const JOB_TYPES: readonly JobType[] = ['renovation', 'roofing', 'contracting'];
const KINDS = ['estimate', 'fixed'] as const;
const STAGES = ['guide', 'pricing', 'review'] as const;
const TIERS: readonly TierKey[] = ['value', 'standard', 'premium'];

export type ImportPreview = { quotes: Quote[]; duplicates: number[]; warnings: string[]; format: string };

class ImportValidationError extends Error {}

function fail(message: string): never { throw new ImportValidationError(message); }

function defWhenUndefined(value: unknown, fallback: number): unknown {
  return value === undefined ? fallback : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

// Money/cents safety: finite, non-negative, exactly representable in cents, no unsafe overflow.
function safeMoney(value: unknown, label: string): number {
  if (!isFiniteNumber(value)) fail(`${label} must be a finite number`);
  if (value < 0) fail(`${label} must not be negative`);
  if (value > MAX_MONEY) fail(`${label} exceeds the maximum supported money amount`);
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents) || Math.abs(value * 100 - cents) > 1e-6) fail(`${label} is not a valid dollar/cents amount`);
  return cents / 100;
}

function safeNonNegative(value: unknown, label: string): number {
  if (!isFiniteNumber(value)) fail(`${label} must be a finite number`);
  if (value < 0) fail(`${label} must not be negative`);
  if (value > MAX_MONEY) fail(`${label} exceeds the maximum supported money amount`);
  return value;
}

function safeString(value: unknown, label: string, max: number, allowEmpty = true): string {
  if (typeof value !== 'string') fail(`${label} must be a string`);
  if (!allowEmpty && !value.trim()) fail(`${label} must not be empty`);
  if (value.length > max) fail(`${label} exceeds ${max} characters`);
  return value;
}

// Real app export timestamps are ISO strings from Date#toISOString. JS silently
// normalizes Feb 31 into March 3, so we verify the parsed value round-trips to
// a real calendar day; legitimate ISO formats are canonicalized to UTC.
function safeTimestamp(value: unknown, label: string): string {
  const text = safeString(value, label, 40, false);
  // Validate the source calendar day separately: Date.parse normalizes Feb 31.
  // Explicit-zone ISO timestamps (with or without milliseconds) and date-only
  // values are accepted and canonicalized to UTC; local-time ambiguity is not.
  const match = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|[+-]\d{2}:\d{2}))?$/.exec(text);
  if (!match || Number(match[2] ?? 0) > 23 || Number(match[3] ?? 0) > 59 || Number(match[4] ?? 0) > 59) fail(`${label} is not a valid date`);
  const day = new Date(`${match[1]}T00:00:00Z`);
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== match[1]) fail(`${label} is not a valid calendar date`);
  const ms = Date.parse(text);
  if (!Number.isFinite(ms)) fail(`${label} is not a valid date`);
  return new Date(ms).toISOString();
}

function safeAnswers(value: unknown, label: string): Answers {
  if (!isRecord(value)) fail(`${label} must be an object`);
  const keys = Object.keys(value);
  if (keys.length > MAX_ANSWER_ENTRIES) fail(`${label} exceeds ${MAX_ANSWER_ENTRIES} entries`);
  const answers: Answers = {};
  for (const key of keys) {
    // Reject prototype-pollution keys before any assignment: a hostile export can
    // smuggle these names as own JSON properties and they must never reach a quote.
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') fail(`${label} contains a reserved answer key: ${key}`);
    if (!key || key.length > MAX_ANSWER_KEY_CHARS) fail(`${label} has an invalid key`);
    const raw = value[key];
    if (typeof raw === 'string') {
      answers[key] = safeString(raw, `${label}.${key}`, MAX_ANSWER_VALUE_CHARS);
    } else if (Array.isArray(raw)) {
      if (raw.length > MAX_ANSWER_ARRAY_ITEMS) fail(`${label}.${key} exceeds ${MAX_ANSWER_ARRAY_ITEMS} items`);
      answers[key] = raw.map(item => {
        if (typeof item !== 'string') fail(`${label}.${key} must contain only strings`);
        return safeString(item, `${label}.${key}`, MAX_ANSWER_VALUE_CHARS);
      });
    } else {
      fail(`${label}.${key} must be a string or array of strings`);
    }
  }
  return answers;
}

function safeLines(value: unknown, label: string): Line[] {
  if (!Array.isArray(value)) fail(`${label} must be an array`);
  if (value.length > MAX_LINES_PER_QUOTE) fail(`${label} exceeds ${MAX_LINES_PER_QUOTE} lines`);
  return value.map((raw, index) => {
    if (!isRecord(raw)) fail(`${label}[${index}] must be an object`);
    return {
      id: safeString(raw.id, `${label}[${index}].id`, 120, false),
      description: safeString(raw.description, `${label}[${index}].description`, MAX_LINE_DESCRIPTION_CHARS),
      quantity: safeNonNegative(raw.quantity, `${label}[${index}].quantity`),
      unit: safeString(raw.unit, `${label}[${index}].unit`, MAX_UNIT_CHARS),
      material: safeMoney(raw.material, `${label}[${index}].material`),
      hours: safeNonNegative(raw.hours, `${label}[${index}].hours`),
      rate: safeMoney(raw.rate, `${label}[${index}].rate`),
    };
  });
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], label: string): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) fail(`${label} is not a supported value`);
  return value as T;
}

function optionalTier(value: unknown, label: string): TierKey | undefined {
  if (value === undefined) return undefined;
  return oneOf(value, TIERS, label);
}

function optionalPercent(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined;
  const percent = safeMoney(value, label);
  if (percent > 100) fail(`${label} must be between 0 and 100`);
  return percent;
}

// Strict whitelist: every imported field must be explicitly allowed; metadata
// (approvedAt/acknowledged/portal/ai) and all unknown fields are stripped.
function candidate(raw: unknown, label: string): Quote {
  if (!isRecord(raw)) fail(`${label} must be an object`);
  const type = oneOf(raw.type, JOB_TYPES, `${label}.type`);
  const kind = oneOf(raw.kind ?? 'estimate', KINDS, `${label}.kind`);
  const stage = oneOf(raw.stage ?? 'guide', STAGES, `${label}.stage`);
  const pricingRaw = raw.pricing;
  if (!isRecord(pricingRaw)) fail(`${label}.pricing must be an object`);
  const step = raw.step ?? 0;
  if (!isFiniteNumber(step) || step < 0 || !Number.isInteger(step)) fail(`${label}.step must be a non-negative integer`);
  const createdAt = safeTimestamp(raw.createdAt ?? new Date().toISOString(), `${label}.createdAt`);
  const updatedAt = safeTimestamp(raw.updatedAt ?? createdAt, `${label}.updatedAt`);
  return {
    id: safeString(raw.id, `${label}.id`, 120, false),
    type,
    createdAt,
    updatedAt,
    acknowledged: false,
    step,
    stage,
    answers: safeAnswers(raw.answers ?? {}, `${label}.answers`),
    lines: safeLines(raw.lines ?? [], `${label}.lines`),
    pricing: {
      laborRate: safeMoney(defWhenUndefined(pricingRaw.laborRate, 0), `${label}.pricing.laborRate`),
      markup: safeNonNegative(defWhenUndefined(pricingRaw.markup, 15), `${label}.pricing.markup`),
      contingency: safeNonNegative(defWhenUndefined(pricingRaw.contingency, 0), `${label}.pricing.contingency`),
      tax: safeNonNegative(defWhenUndefined(pricingRaw.tax, 0), `${label}.pricing.tax`),
    },
    exclusions: safeString(raw.exclusions ?? '', `${label}.exclusions`, MAX_TEXT_CHARS),
    assumptions: safeString(raw.assumptions ?? '', `${label}.assumptions`, MAX_TEXT_CHARS),
    terms: safeString(raw.terms ?? '', `${label}.terms`, MAX_TEXT_CHARS),
    kind,
    tier: optionalTier(raw.tier, `${label}.tier`),
    discountPercent: optionalPercent(raw.discountPercent, `${label}.discountPercent`),
  };
}

// Money bound beyond raw unit cost: every line product (quantity*material,
// hours*rate) and the full quote aggregate (direct, contingency, markup, tax,
// fee, discount, total) must stay finite, non-negative and within MAX_MONEY,
// using the app's actual calculator so import math matches Review exactly.
function validateQuoteMoneyBounds(quote: Quote, label: string): void {
  for (const [index, line] of quote.lines.entries()) {
    const materials = line.quantity * line.material;
    if (!Number.isFinite(materials) || materials > MAX_MONEY) fail(`${label}.lines[${index}] material amount exceeds the maximum supported money amount`);
    const labor = line.hours * line.rate;
    if (!Number.isFinite(labor) || labor > MAX_MONEY) fail(`${label}.lines[${index}] labor amount exceeds the maximum supported money amount`);
  }
  const totals = computeMargin(quote.lines, quote.pricing, 10, quote.discountPercent ?? 0);
  const aggregates = [totals.internalCost, totals.preDiscountTotal, totals.customerPrice, totals.discountDollars, totals.markup, totals.marginDollars];
  for (const value of aggregates) {
    if (!Number.isFinite(value)) fail(`${label} pricing aggregate is not a finite number`);
    if (value < 0) fail(`${label} pricing aggregate must not be negative`);
    if (value > MAX_MONEY) fail(`${label} pricing aggregate exceeds the maximum supported money amount`);
  }
}

// Canonical duplicate fingerprint: same job content excluding ids, timestamps and
// approval metadata. Answer keys are sorted so the same answers supplied in a
// different insertion order detect as duplicates; array order is preserved.
function fingerprint(quote: Quote): string {
  const sortedAnswers: Record<string, string | string[]> = {};
  for (const key of Object.keys(quote.answers).sort()) sortedAnswers[key] = quote.answers[key];
  return JSON.stringify({
    type: quote.type,
    kind: quote.kind,
    answers: sortedAnswers,
    lines: quote.lines.map(line => ({ description: line.description, quantity: line.quantity, unit: line.unit, material: line.material, hours: line.hours, rate: line.rate })),
    pricing: quote.pricing,
    tier: quote.tier,
    discountPercent: quote.discountPercent,
    exclusions: quote.exclusions,
    assumptions: quote.assumptions,
    terms: quote.terms,
  });
}

function fingerprintExisting(quote: Quote): string {
  // Existing quotes may carry stripped metadata (approvedAt/ai/portal); fingerprint the same fields.
  return fingerprint({ ...quote, approvedAt: undefined, acknowledged: false, ai: undefined, portal: undefined } as Quote);
}

export function parseDraftImport(text: string, existing: Quote[]): ImportPreview {
  if (typeof text !== 'string') fail('Import payload must be a string');
  if (text.length > MAX_PAYLOAD_CHARS) fail(`Import payload exceeds the ${MAX_PAYLOAD_CHARS / (1024 * 1024)} MiB limit`);
  if (!text.trim()) fail('Import payload is empty');

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    fail('Import payload is not valid JSON');
  }
  if (!isRecord(data)) fail('Import payload must be a JSON object');

  const version = data.version;
  if (version !== 1) fail(`Unsupported import version: ${JSON.stringify(version ?? null)}. Only version 1 exports are supported.`);

  if ('quote' in data && 'quotes' in data) fail('Ambiguous import format: choose quote or quotes, not both.');
  const warnings: string[] = [];
  if ('calculatedTotals' in data) warnings.push('Imported calculatedTotals were ignored; totals are recomputed from line items and pricing.');

  let imported: Quote[];
  let format: string;
  let currentPricing: Pricing | undefined;

  if ('quote' in data) {
    // Real format from Review.tsx exportQuote: { version: 1, quote, calculatedTotals }
    format = 'quote-export-v1';
    imported = [candidate(data.quote, 'quote')];
  } else if ('quotes' in data) {
    // Real format from Settings backup: SavedState { version: 1, quotes, pricing }
    format = 'settings-backup-v1';
    if (!Array.isArray(data.quotes)) fail('quotes must be an array');
    if (data.quotes.length > MAX_QUOTES) fail(`Import payload exceeds ${MAX_QUOTES} quotes`);
    if (!isRecord(data.pricing)) fail('pricing must be an object');
    currentPricing = {
      laborRate: safeMoney(defWhenUndefined(data.pricing.laborRate, 0), 'pricing.laborRate'),
      markup: safeNonNegative(defWhenUndefined(data.pricing.markup, 15), 'pricing.markup'),
      contingency: safeNonNegative(defWhenUndefined(data.pricing.contingency, 0), 'pricing.contingency'),
      tax: safeNonNegative(defWhenUndefined(data.pricing.tax, 0), 'pricing.tax'),
    };
    imported = data.quotes.map((raw, index) => candidate(raw, `quotes[${index}]`));
  } else {
    fail('Import payload is neither a quote export nor a settings backup');
  }

  for (const [index, quote] of imported.entries()) {
    validateQuoteMoneyBounds(quote, format === 'quote-export-v1' ? 'quote' : `quotes[${index}]`);
  }

  // Duplicate detection: same id OR same content, against existing quotes and within the payload.
  const duplicates: number[] = [];
  const seenFingerprints = new Set<string>(existing.map(fingerprintExisting));
  const seenIds = new Set(existing.map(quote => quote.id));
  for (let index = 0; index < imported.length; index++) {
    const quote = imported[index];
    if (seenIds.has(quote.id) || seenFingerprints.has(fingerprint(quote))) {
      duplicates.push(index);
      warnings.push(`Duplicate detected: "${quote.id}" matches an existing quote or another imported quote.`);
      continue;
    }
    seenIds.add(quote.id);
    seenFingerprints.add(fingerprint(quote));
  }

  if (currentPricing) warnings.push('Global pricing from the backup was noted; existing global pricing is preserved on import.');
  return { quotes: imported, duplicates, warnings, format };
}

export function commitDraftImport(preview: ImportPreview, current: SavedState, options: { allowDuplicates: boolean }, store: Pick<Storage, 'setItem'> = localStorage): SavedState {
  if (!preview || !Array.isArray(preview.quotes)) fail('Invalid import preview');
  if (!current || !Array.isArray(current.quotes)) fail('Invalid current state');
  if (preview.quotes.length > MAX_QUOTES) fail(`Import exceeds ${MAX_QUOTES} quotes`);
  // B2 hardening: never trust preview data (quotes, duplicates, warnings, format).
  // Re-run every preview quote through the same strict whitelist and money bounds
  // used at parse time, so a tampered/stale preview cannot smuggle metadata,
  // invalid pricing or oversized values into saved state.
  const sanitized = preview.quotes.map((raw, index) => {
    const quote = candidate(raw, `import.quotes[${index}]`);
    validateQuoteMoneyBounds(quote, `import.quotes[${index}]`);
    return quote;
  });

  // Recompute duplicate detection from ACTUAL current quotes plus the sanitized
  // batch — preview.duplicates may be stale or tampered in either direction.
  const seenFingerprints = new Set(current.quotes.map(fingerprintExisting));
  const seenIds = new Set(current.quotes.map(quote => quote.id));
  const batchDuplicates: number[] = [];
  for (let index = 0; index < sanitized.length; index++) {
    const quote = sanitized[index];
    if (seenIds.has(quote.id) || seenFingerprints.has(fingerprint(quote))) {
      batchDuplicates.push(index);
      continue;
    }
    seenIds.add(quote.id);
    seenFingerprints.add(fingerprint(quote));
  }
  if (batchDuplicates.length && !options?.allowDuplicates) fail('Import contains duplicates. Choose Copy or Cancel.');

  const now = new Date().toISOString();
  const next: SavedState = {
    version: 1,
    quotes: [...current.quotes, ...sanitized.map(quote => ({
      id: newId(),
      type: quote.type,
      createdAt: now,
      updatedAt: now,
      acknowledged: false,
      step: 0,
      stage: 'review' as const,
      answers: quote.answers,
      lines: quote.lines.map(line => ({ ...line, id: newId() })),
      pricing: quote.pricing,
      exclusions: quote.exclusions,
      assumptions: quote.assumptions,
      terms: quote.terms,
      kind: quote.kind,
      tier: quote.tier,
      discountPercent: quote.discountPercent,
    }))],
    pricing: { ...current.pricing },
  };
  // Single, atomic write. On quota failure this throws and current state/browser data stays unchanged.
  store.setItem('revive-quotes-v1', JSON.stringify(next));
  return next;
}
