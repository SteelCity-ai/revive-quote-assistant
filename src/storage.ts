import { defaults } from './domain';
import type { Pricing, Quote } from './domain';
const KEY = 'revive-quotes-v1';
export type SavedState = { version: 1; quotes: Quote[]; pricing: Pricing };
export function load(): { data: SavedState; error: string } {
  const empty: SavedState = { version: 1, quotes: [], pricing: { ...defaults } };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { data: empty, error: '' };
    const data = JSON.parse(raw) as SavedState;
    if (data.version !== 1 || !Array.isArray(data.quotes) || !data.pricing || data.quotes.some(q => !q.id || !q.answers || !Array.isArray(q.lines) || !['renovation', 'roofing', 'contracting'].includes(q.type))) throw new Error('Invalid saved data');
    return { data, error: '' };
  } catch { return { data: empty, error: 'Saved data could not be loaded. Existing browser data has been preserved. Export it before resetting or using another browser.' }; }
}
export function save(data: SavedState) { localStorage.setItem(KEY, JSON.stringify(data)); }
export function download(name: string, content: string, mime = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
