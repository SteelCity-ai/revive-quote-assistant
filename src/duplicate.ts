import { newId } from './domain';
import type { Quote } from './domain';

/**
 * Duplicate a saved quote (STE-471).
 *
 * Field quotes often repeat: same customer type, same scope shape, slightly
 * different quantities. Duplicating a draft is the fastest correct path, but
 * the copy must never inherit approval, portal receipt/share state or an AI
 * report fingerprint that makes the app believe the copy was already reviewed.
 *
 * The copy therefore:
 *  - gets a new quote id and new line ids (no shared identity with the source),
 *  - starts as an unapproved draft with no portal/approval/AI state,
 *  - keeps job answers, lines, pricing settings and terms so it is useful,
 *  - gets a distinct, numbered title so the list stays readable.
 * The source quote is never modified (deep copy, no shared references).
 */

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const COPY_MARKER = /\(copy(?: \d+)?\)$/i;

/** Strip the title so repeated duplication does not stack "(copy) (copy)". */
function titleStem(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) return 'Untitled quote';
  const stripped = trimmed.replace(COPY_MARKER, '').trim();
  return stripped || 'Untitled quote';
}

/**
 * Build a title that does not collide with an existing quote:
 * "Kitchen build-out" -> "Kitchen build-out (copy)" -> "Kitchen build-out (copy 2)".
 */
export function copyTitle(title: string, existing: Quote[]): string {
  const taken = new Set(existing.map(q => String(q.answers.title ?? '').trim()));
  const stem = titleStem(title);
  let candidate = `${stem} (copy)`;
  let n = 2;
  while (taken.has(candidate) && n <= 99) {
    candidate = `${stem} (copy ${n})`;
    n += 1;
  }
  return candidate;
}

/** True when a quote with the same customer, title and line set already exists. */
export function hasSimilarDraft(quote: Quote, existing: Quote[]): boolean {
  const key = (q: Quote): string => JSON.stringify({
    type: q.type,
    title: String(q.answers.title ?? '').trim().toLowerCase(),
    customer: String(q.answers.customer ?? '').trim().toLowerCase(),
    lines: q.lines.map(l => [l.description, l.quantity, l.unit, l.material, l.hours, l.rate]),
  });
  const target = key(quote);
  return existing.some(q => q.id !== quote.id && key(q) === target);
}

/**
 * Create a new unapproved draft from an existing quote.
 * Returns a fresh object; the source quote is untouched.
 */
export function duplicateQuote(source: Quote, existing: Quote[] = []): Quote {
  const copy = clone(source);
  const now = new Date().toISOString();
  copy.id = newId();
  copy.createdAt = now;
  copy.updatedAt = now;
  copy.answers = { ...copy.answers, title: copyTitle(String(source.answers.title ?? ''), existing) };
  copy.lines = copy.lines.map(line => ({ ...line, id: newId() }));
  copy.approvedAt = undefined;
  copy.acknowledged = false;
  delete copy.portal;
  delete copy.ai;
  return copy;
}
