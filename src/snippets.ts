import { newId, type Line } from './domain';

// STE-103: bounded, versioned device snippet library for reusable scope lines.
// Pure module — no UI, no dependencies. Storage key is separate from quotes.

export const SNIPPETS_STORAGE_KEY = 'revive-scope-snippets-v1';
export const SNIPPETS_VERSION = 1;
export const SNIPPETS_MAX_COUNT = 100;
export const SNIPPETS_MAX_LINES = 200;
export const SNIPPETS_MAX_TOTAL_BYTES = 500 * 1024;
const MAX_NAME = 120;
const MAX_DESC = 2000;
const MAX_UNIT = 40;

export type SnippetLine = {
  description: string;
  quantity: number;
  unit: string;
  material: number;
  hours: number;
  rate: number;
};

export type Snippet = {
  id: string;
  name: string;
  savedAt: string;
  lines: SnippetLine[];
};

export type SnippetsStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export type SaveSnippetInput = {
  name: string;
  lines: Line[];
  savedAt?: string;
};

export type SaveSnippetResult =
  | { ok: true; snippet: Snippet }
  | { ok: false; error: SnippetError };

export type SnippetError =
  | 'invalid-input'
  | 'quota-snippets'
  | 'quota-lines'
  | 'quota-storage'
  | 'corrupt-storage'
  | 'unsupported-version';

export type LoadSnippetsResult =
  | { ok: true; snippets: Snippet[] }
  | { ok: false; error: SnippetError; snippets?: never };

export type DeleteSnippetResult =
  | { ok: true; deleted: true }
  | { ok: false; error: SnippetError };

export type AppendSnippetLinesResult =
  | { ok: true; lines: Line[]; appended: Line[] }
  | { ok: false; error: SnippetError; lines?: never };

const isFiniteNonNeg = (n: unknown): n is number =>
  typeof n === 'number' && Number.isFinite(n) && n >= 0;

// Derived money safety: quantity*material and hours*rate must be finite,
// non-negative, and representable as safe integer cents; the per-snippet
// aggregate must stay finite too. Guards save, load (tampered persisted
// data) and append boundaries against Infinity/unsafe overflow.
function derivedMoneySafe(line: { quantity: number; material: number; hours: number; rate: number }): boolean {
  const materialCost = line.quantity * line.material;
  const laborCost = line.hours * line.rate;
  if (!Number.isFinite(materialCost) || materialCost < 0) return false;
  if (!Number.isFinite(laborCost) || laborCost < 0) return false;
  if (!Number.isSafeInteger(Math.round(materialCost * 100))) return false;
  if (!Number.isSafeInteger(Math.round(laborCost * 100))) return false;
  return true;
}

export function snippetMoneySafe(lines: SnippetLine[]): boolean {
  if (!Array.isArray(lines)) return false;
  let total = 0;
  for (const l of lines) {
    if (!derivedMoneySafe(l)) return false;
    total += l.quantity * l.material + l.hours * l.rate;
  }
  return Number.isFinite(total) && Number.isSafeInteger(Math.round(total * 100));
}

const cloneError = <T extends { ok: false; error: SnippetError }>(r: T): T => ({ ...r });

function sanitizeLine(line: Line): SnippetLine | null {
  if (typeof line.description !== 'string' || !line.description.trim()) return null;
  const description = line.description.slice(0, MAX_DESC);
  const unit = typeof line.unit === 'string' ? line.unit.slice(0, MAX_UNIT) : '';
  if (!isFiniteNonNeg(line.quantity) || line.quantity <= 0) return null;
  if (!isFiniteNonNeg(line.material) ||
      !isFiniteNonNeg(line.hours) || !isFiniteNonNeg(line.rate)) return null;
  if (!derivedMoneySafe(line)) return null;
  return {
    description,
    quantity: line.quantity,
    unit,
    material: line.material,
    hours: line.hours,
    rate: line.rate,
  };
}

export function sanitizeSnippetLines(lines: Line[]): SnippetLine[] | null {
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > SNIPPETS_MAX_LINES) return null;
  const out: SnippetLine[] = [];
  for (const line of lines) {
    const s = sanitizeLine(line);
    if (!s) return null;
    out.push(s);
  }
  if (!snippetMoneySafe(out)) return null;
  return out;
}

function defaultStorage(): SnippetsStorage {
  if (typeof localStorage === 'undefined') {
    throw new Error('No storage available');
  }
  return localStorage;
}

function parseStore(raw: string): { snippets: Snippet[] } | { error: SnippetError } {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { error: 'corrupt-storage' };
  }
  if (!data || typeof data !== 'object') return { error: 'corrupt-storage' };
  const version = (data as { version?: unknown }).version;
  if (version !== SNIPPETS_VERSION) return { error: 'unsupported-version' };
  const snippets = (data as { snippets?: unknown }).snippets;
  if (!Array.isArray(snippets)) return { error: 'corrupt-storage' };
  for (const s of snippets) {
    if (!s || typeof s !== 'object') return { error: 'corrupt-storage' };
    const o = s as Partial<Snippet>;
    if (typeof o.id !== 'string' || !o.id) return { error: 'corrupt-storage' };
    if (typeof o.name !== 'string' || !o.name) return { error: 'corrupt-storage' };
    if (typeof o.savedAt !== 'string' || !o.savedAt) return { error: 'corrupt-storage' };
    if (!Array.isArray(o.lines)) return { error: 'corrupt-storage' };
    for (const l of o.lines) {
      if (!l || typeof l !== 'object') return { error: 'corrupt-storage' };
      const lo = l as Partial<SnippetLine>;
      if (typeof lo.description !== 'string' || typeof lo.unit !== 'string') return { error: 'corrupt-storage' };
      if (!isFiniteNonNeg(lo.quantity) || lo.quantity <= 0 || !isFiniteNonNeg(lo.material) ||
          !isFiniteNonNeg(lo.hours) || !isFiniteNonNeg(lo.rate)) return { error: 'corrupt-storage' };
      if (!derivedMoneySafe(lo)) return { error: 'corrupt-storage' };
    }
    if (!snippetMoneySafe(o.lines as SnippetLine[])) return { error: 'corrupt-storage' };
  }
  return { snippets: snippets as Snippet[] };
}

function persist(snippets: Snippet[], storage: SnippetsStorage): SnippetError | null {
  const raw = JSON.stringify({ version: SNIPPETS_VERSION, snippets });
  if (raw.length > SNIPPETS_MAX_TOTAL_BYTES) return 'quota-storage';
  try {
    storage.setItem(SNIPPETS_STORAGE_KEY, raw);
  } catch {
    return 'quota-storage';
  }
  return null;
}

export function loadSnippets(storage?: SnippetsStorage): LoadSnippetsResult {
  let st: SnippetsStorage;
  try {
    st = storage ?? defaultStorage();
  } catch {
    return { ok: false, error: 'corrupt-storage' };
  }
  const raw = st.getItem(SNIPPETS_STORAGE_KEY);
  if (raw === null) return { ok: true, snippets: [] };
  const parsed = parseStore(raw);
  if ('error' in parsed) return { ok: false, error: parsed.error };
  return { ok: true, snippets: parsed.snippets };
}

export function saveSnippet(
  input: SaveSnippetInput,
  storage?: SnippetsStorage,
): SaveSnippetResult {
  let st: SnippetsStorage;
  try {
    st = storage ?? defaultStorage();
  } catch {
    return { ok: false, error: 'corrupt-storage' };
  }
  const name = typeof input?.name === 'string' ? input.name.trim().slice(0, MAX_NAME) : '';
  if (!name) return { ok: false, error: 'invalid-input' };
  const lines = sanitizeSnippetLines(input?.lines as Line[] | undefined ?? []);
  if (!lines) return { ok: false, error: 'invalid-input' };

  const loaded = loadSnippets(st);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const existing = loaded.snippets;
  if (existing.length >= SNIPPETS_MAX_COUNT) return { ok: false, error: 'quota-snippets' };

  const snippet: Snippet = {
    id: newId(),
    name,
    savedAt: typeof input.savedAt === 'string' && input.savedAt ? input.savedAt : new Date().toISOString(),
    lines,
  };
  const next = [...existing, snippet];
  const err = persist(next, st);
  if (err) return { ok: false, error: err };
  return { ok: true, snippet };
}

export function deleteSnippet(id: string, storage?: SnippetsStorage): DeleteSnippetResult {
  let st: SnippetsStorage;
  try {
    st = storage ?? defaultStorage();
  } catch {
    return { ok: false, error: 'corrupt-storage' };
  }
  if (typeof id !== 'string' || !id) return { ok: false, error: 'invalid-input' };
  const loaded = loadSnippets(st);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const next = loaded.snippets.filter((s) => s.id !== id);
  if (next.length === loaded.snippets.length) return { ok: false, error: 'invalid-input' };
  const err = persist(next, st);
  if (err) return { ok: false, error: err };
  return { ok: true, deleted: true };
}

export function findSnippet(id: string, snippets: Snippet[]): Snippet | null {
  return snippets.find((s) => s.id === id) ?? null;
}

export function previewSnippet(snippet: Snippet): SnippetLine[] {
  return snippet.lines.map((l) => ({ ...l }));
}

export function appendSnippetLines(
  snippetId: string,
  existingLines: Line[],
  storage?: SnippetsStorage,
): AppendSnippetLinesResult {
  let st: SnippetsStorage;
  try {
    st = storage ?? defaultStorage();
  } catch {
    return { ok: false, error: 'corrupt-storage' };
  }
  const loaded = loadSnippets(st);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  const snippet = findSnippet(snippetId, loaded.snippets);
  if (!snippet) return { ok: false, error: 'invalid-input' };
  if (!Array.isArray(existingLines)) return { ok: false, error: 'invalid-input' };
  if (existingLines.length + snippet.lines.length > SNIPPETS_MAX_LINES) {
    return { ok: false, error: 'quota-lines' };
  }
  const appended: Line[] = snippet.lines.map((l) => ({
    id: newId(),
    description: l.description,
    quantity: l.quantity,
    unit: l.unit,
    material: l.material,
    hours: l.hours,
    rate: l.rate,
  }));
  if (!snippetMoneySafe(appended)) return { ok: false, error: 'invalid-input' };
  return { ok: true, lines: [...existingLines, ...appended], appended };
}

export function searchSnippets(snippets: Snippet[], query: string): Snippet[] {
  if (!Array.isArray(snippets)) return [];
  const q = typeof query === 'string' ? query.trim().toLowerCase() : '';
  if (!q) return [...snippets];
  return snippets.filter(
    (s) =>
      s.name.toLowerCase().includes(q) ||
      s.lines.some((l) => l.description.toLowerCase().includes(q)),
  );
}

export function previewDuplicate(
  input: { name: string; lines: Line[] },
  snippets: Snippet[],
): Snippet | null {
  if (!Array.isArray(snippets)) return null;
  const name = typeof input?.name === 'string' ? input.name.trim().toLowerCase() : '';
  if (!name) return null;
  const lines = sanitizeSnippetLines(input?.lines ?? []);
  if (!lines) return null;
  const key = JSON.stringify(lines);
  return (
    snippets.find(
      (s) => s.name.trim().toLowerCase() === name && JSON.stringify(s.lines) === key,
    ) ?? null
  );
}
