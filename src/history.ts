import type { Quote } from './domain';
import { newId } from './domain';
import { discountedTotals } from './margin';

/**
 * Draft version history (Q1).
 *
 * Snapshots are named, bounded checkpoints of a quote taken at meaningful
 * moments — never one per keystroke. Comparison reuses the deterministic
 * totals() money math from domain.ts. Restoring a snapshot creates a NEW
 * draft quote with a fresh UUID and cleared approval/portal state; the
 * original quote and any accepted revision stay untouched.
 */

export type QuoteSnapshot = {
  id: string; // unique snapshot id, independent of the quote
  quoteId: string; // quote the snapshot was captured from
  name: string; // optional human label; empty string when unnamed
  createdAt: string; // ISO timestamp of capture
  quote: Quote; // deep copy of the quote at capture time
};

/** Hard cap on stored checkpoints per quote — prevents unbounded growth. */
export const MAX_SNAPSHOTS = 20;

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Strip all portal receipt/share/acceptance and approval metadata. */
function clearApprovalState(quote: Quote): Quote {
  const restored: Quote = { ...clone(quote), id: newId() };
  restored.createdAt = new Date().toISOString();
  restored.updatedAt = restored.createdAt;
  restored.approvedAt = undefined;
  restored.acknowledged = false;
  delete restored.portal;
  delete restored.ai;
  return restored;
}

/** Capture a named checkpoint of a quote. The stored quote is a deep copy. */
export function captureSnapshot(quote: Quote, name = ''): QuoteSnapshot {
  return {
    id: newId(),
    quoteId: quote.id,
    name: name.trim(),
    createdAt: new Date().toISOString(),
    quote: clone(quote),
  };
}

/**
 * Add a snapshot to a bounded history list, keeping the newest MAX_SNAPSHOTS.
 * Oldest entries beyond the cap are dropped; returns the updated list.
 */
export function addSnapshot(history: QuoteSnapshot[], snapshot: QuoteSnapshot): QuoteSnapshot[] {
  const next = [...history, snapshot];
  return next.slice(Math.max(0, next.length - MAX_SNAPSHOTS));
}

/** Restore a snapshot as a NEW unapproved draft (new UUID, cleared portal/approval state). */
export function restoreSnapshot(snapshot: QuoteSnapshot): Quote {
  return clearApprovalState(snapshot.quote);
}

export type LineDiff = {
  description: string;
  /** Present when a stable line kept its id but its description was edited. */
  fromDescription?: string;
  kind: 'added' | 'removed' | 'changed';
  from?: { quantity: number; unit: string; material: number; hours: number; rate: number };
  to?: { quantity: number; unit: string; material: number; hours: number; rate: number };
};

export type ValueDiff = { field: string; from: string; to: string };

export type QuoteDiff = {
  lineChanges: LineDiff[];
  scopeChanges: { field: 'exclusions' | 'assumptions' | 'terms'; from: string; to: string }[];
  /** Job answers that changed (customer-visible scope detail). */
  answerChanges: ValueDiff[];
  /** Quote-level shape changes: job type, quote kind, guide/review stage. */
  quoteChanges: { field: 'type' | 'kind' | 'stage'; from: string; to: string }[];
  /** Pricing settings incl. tier and owner discount percent. */
  pricingChanges: { field: string; from: number | string; to: number | string }[];
  /** Recomputed discounted customer totals (margin.ts semantics). */
  totalChanges: { field: string; from: number; to: number }[];
};

/** Match lines by stable id; fall back to description only for legacy rows without an id. */
const lineKey = (l: { id?: string; description: string }) =>
  l.id && l.id.trim() ? `id:${l.id}` : `desc:${l.description.trim().toLowerCase()}`;

const formatAnswer = (value: unknown): string =>
  Array.isArray(value) ? value.join(', ') : typeof value === 'string' ? value : value == null ? '' : String(value);

/** Compare two quotes (e.g. a snapshot against the current draft). */
export function compareQuotes(from: Quote, to: Quote): QuoteDiff {
  const fromLines = new Map<string, Quote['lines'][number]>();
  for (const l of from.lines) fromLines.set(lineKey(l), l);
  const toLines = new Map<string, Quote['lines'][number]>();
  for (const l of to.lines) toLines.set(lineKey(l), l);

  const lineChanges: LineDiff[] = [];
  for (const [key, next] of toLines) {
    const prev = fromLines.get(key);
    if (!prev) {
      lineChanges.push({ description: next.description, kind: 'added', to: pick(next) });
    } else {
      const renamed = prev.description !== next.description;
      const changed = renamed || prev.quantity !== next.quantity || prev.unit !== next.unit ||
        prev.material !== next.material || prev.hours !== next.hours || prev.rate !== next.rate;
      if (changed) {
        lineChanges.push({
          description: next.description,
          ...(renamed ? { fromDescription: prev.description } : {}),
          kind: 'changed', from: pick(prev), to: pick(next),
        });
      }
    }
  }
  for (const [key, prev] of fromLines) {
    if (!toLines.has(key)) lineChanges.push({ description: prev.description, kind: 'removed', from: pick(prev) });
  }

  const scopeChanges = (['exclusions', 'assumptions', 'terms'] as const)
    .filter(f => from[f] !== to[f])
    .map(f => ({ field: f, from: from[f], to: to[f] }));

  const answerKeys = Array.from(new Set([...Object.keys(from.answers), ...Object.keys(to.answers)])).sort();
  const answerChanges = answerKeys
    .filter(k => formatAnswer(from.answers[k]) !== formatAnswer(to.answers[k]))
    .map(k => ({ field: k, from: formatAnswer(from.answers[k]), to: formatAnswer(to.answers[k]) }));

  const quoteChanges = (['type', 'kind', 'stage'] as const)
    .filter(f => from[f] !== to[f])
    .map(f => ({ field: f, from: String(from[f]), to: String(to[f]) }));

  const pricingChanges: QuoteDiff['pricingChanges'] = (Object.keys(from.pricing) as (keyof Quote['pricing'])[])
    .filter(f => from.pricing[f] !== to.pricing[f])
    .map(f => ({ field: f, from: from.pricing[f], to: to.pricing[f] }));
  if ((from.discountPercent ?? 0) !== (to.discountPercent ?? 0)) {
    pricingChanges.push({ field: 'discountPercent', from: from.discountPercent ?? 0, to: to.discountPercent ?? 0 });
  }
  if ((from.tier ?? '') !== (to.tier ?? '')) {
    pricingChanges.push({ field: 'tier', from: from.tier ?? '', to: to.tier ?? '' });
  }

  // Customer-facing totals use Review's discounted pricing semantics: the owner
  // discount compresses markup, so a discount change must surface here.
  const fromTotals = discountedTotals(from.lines, from.pricing, from.discountPercent ?? 0);
  const toTotals = discountedTotals(to.lines, to.pricing, to.discountPercent ?? 0);
  const totalChanges = (Object.keys(fromTotals) as (keyof typeof fromTotals)[])
    .filter(f => fromTotals[f] !== toTotals[f])
    .map(f => ({ field: f, from: fromTotals[f], to: toTotals[f] }));

  return { lineChanges, scopeChanges, answerChanges, quoteChanges, pricingChanges, totalChanges };
}

const pick = (l: { quantity: number; unit: string; material: number; hours: number; rate: number }) =>
  ({ quantity: l.quantity, unit: l.unit, material: l.material, hours: l.hours, rate: l.rate });

/**
 * Versioned persistence under a dedicated key. The legacy quote store
 * (revive-quotes-v1) is never read or written here. Storage is injectable so
 * tests can simulate corrupt data, quota exhaustion, and unsupported storage.
 */
export const HISTORY_KEY = 'revive-quote-history-v1';

export type HistoryStorageResult = { snapshots: QuoteSnapshot[]; error: string };

export type HistoryStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

const JOB_TYPES = ['renovation', 'roofing', 'contracting'];
const STAGES = ['guide', 'pricing', 'review'];
const KINDS = ['estimate', 'fixed'];
const TIERS = ['value', 'standard', 'premium'];

function validSnapshot(s: unknown): s is QuoteSnapshot {
  if (!s || typeof s !== 'object') return false;
  const snap = s as Partial<QuoteSnapshot>;
  return (
    typeof snap.id === 'string' && snap.id.length > 0 &&
    typeof snap.quoteId === 'string' && snap.quoteId.length > 0 &&
    typeof snap.name === 'string' &&
    typeof snap.createdAt === 'string' && !Number.isNaN(Date.parse(snap.createdAt)) &&
    validQuote(snap.quote)
  );
}

/** Validate the complete supported Quote shape; partial snapshots are refused, never silently kept. */
function validQuote(q: unknown): q is Quote {
  if (!q || typeof q !== 'object') return false;
  const quote = q as Partial<Quote>;
  return (
    typeof quote.id === 'string' && quote.id.length > 0 &&
    typeof quote.createdAt === 'string' && !Number.isNaN(Date.parse(quote.createdAt)) &&
    typeof quote.updatedAt === 'string' && !Number.isNaN(Date.parse(quote.updatedAt)) &&
    typeof quote.type === 'string' && JOB_TYPES.includes(quote.type) &&
    typeof quote.stage === 'string' && STAGES.includes(quote.stage) &&
    typeof quote.kind === 'string' && KINDS.includes(quote.kind) &&
    (quote.tier === undefined || (typeof quote.tier === 'string' && TIERS.includes(quote.tier))) &&
    (quote.discountPercent === undefined || (typeof quote.discountPercent === 'number' && Number.isFinite(quote.discountPercent))) &&
    !!quote.answers && typeof quote.answers === 'object' && !Array.isArray(quote.answers) &&
    typeof quote.exclusions === 'string' && typeof quote.assumptions === 'string' && typeof quote.terms === 'string' &&
    typeof quote.acknowledged === 'boolean' &&
    Array.isArray(quote.lines) && quote.lines.every(l =>
      !!l && typeof l.id === 'string' && l.id.length > 0 && typeof l.description === 'string' && typeof l.unit === 'string' &&
      Number.isFinite(l.quantity) && Number.isFinite(l.material) && Number.isFinite(l.hours) && Number.isFinite(l.rate)) &&
    !!quote.pricing && Number.isFinite(quote.pricing.laborRate) && Number.isFinite(quote.pricing.markup) &&
    Number.isFinite(quote.pricing.contingency) && Number.isFinite(quote.pricing.tax)
  );
}

function validateHistory(raw: string): QuoteSnapshot[] {
  const data = JSON.parse(raw) as { version?: number; snapshots?: unknown };
  if (!data || data.version !== 1 || !Array.isArray(data.snapshots)) throw new Error('Unsupported history format');
  for (const s of data.snapshots) {
    if (!validSnapshot(s)) throw new Error('Unsupported history format');
  }
  return data.snapshots;
}

/** Load snapshots for all quotes; surfaces errors, never erases old data. */
export function loadHistory(storage: HistoryStorage = typeof localStorage === 'undefined' ? undefined as unknown as HistoryStorage : localStorage): HistoryStorageResult {
  try {
    const raw = storage.getItem(HISTORY_KEY);
    if (!raw) return { snapshots: [], error: '' };
    return { snapshots: validateHistory(raw), error: '' };
  } catch (e) {
    return { snapshots: [], error: e instanceof Error && e.name === 'QuotaExceededError' ? 'Storage is full.' : 'Saved version history could not be loaded. Existing browser data has been preserved.' };
  }
}

/** Save the full snapshot list atomically; surfaces errors without touching existing data on failure. */
export function saveHistory(snapshots: QuoteSnapshot[], storage: HistoryStorage = typeof localStorage === 'undefined' ? undefined as unknown as HistoryStorage : localStorage): string {
  try {
    for (const s of snapshots) if (!validSnapshot(s)) return 'Refusing to save invalid snapshot data.';
    storage.setItem(HISTORY_KEY, JSON.stringify({ version: 1, snapshots }));
    return '';
  } catch (e) {
    return e instanceof Error && (e.name === 'QuotaExceededError' || (e as { code?: number }).code === 22) ? 'Storage is full. Remove old snapshots or export the quote.' : 'Version history could not be saved. Existing browser data has been preserved.';
  }
}

/** Save one quote's snapshot list while preserving every other quote's persisted history. */
export function mergeQuoteHistory(activeQuoteId: string, updatedSnapshots: QuoteSnapshot[], storage?: HistoryStorage): string {
  const existing = loadHistory(storage);
  // Never overwrite unreadable persisted data — refuse and surface the error.
  if (existing.error) return existing.error;
  const others = existing.snapshots.filter(s => s.quoteId !== activeQuoteId);
  const mine = updatedSnapshots.filter(s => s.quoteId === activeQuoteId).slice(-MAX_SNAPSHOTS);
  return saveHistory([...others, ...mine], storage);
}

/** Load one quote's history, capped to the newest MAX_SNAPSHOTS. */
export function loadQuoteHistory(quoteId: string, storage?: HistoryStorage): HistoryStorageResult {
  const { snapshots, error } = loadHistory(storage);
  return { snapshots: snapshots.filter(s => s.quoteId === quoteId).slice(-MAX_SNAPSHOTS), error };
}
