// STE-439 public instant-estimate wait feedback.
// The public estimate calls the AI research pipeline and can legitimately take
// one to four minutes. The page previously showed only a disabled button, so a
// visitor could not tell a slow estimate from a frozen page and could not stop
// it. These helpers keep the wording honest: they describe what the server
// actually does and how long it usually takes. They never claim that a specific
// server stage has finished, because the server gives no such signal.

export const WAIT_SUMMARY =
  'We measure the roof from aerial imagery, research local material and labor prices, then build your estimate. This usually takes one to three minutes.';

export const SLOW_WAIT_MS = 20000;
export const VERY_SLOW_WAIT_MS = 90000;

export const CANCEL_NOTICE =
  'Stopped. Your answers are still here — change anything and try again, or call Revive to quote it directly.';

export function elapsedLabel(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? Math.floor(ms) : 0;
  const minutes = Math.floor(safe / 60000);
  const seconds = Math.floor((safe % 60000) / 1000);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function waitHint(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  if (safe < SLOW_WAIT_MS) return 'Measuring the roof and researching local prices…';
  if (safe < VERY_SLOW_WAIT_MS) return 'Still working. Local price research often takes one to three minutes.';
  return 'This is taking longer than usual. You can keep waiting, or call Revive and we will quote it directly.';
}

export function isAbortError(error: unknown): boolean {
  const name = (error as { name?: unknown } | null)?.name;
  return typeof name === 'string' && name === 'AbortError';
}
