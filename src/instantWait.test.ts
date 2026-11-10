// STE-439 public wait-feedback tests.
// These pin the exact wording rules the InstantEstimate page relies on: an
// honest elapsed clock, hints that never claim a finished server stage, and
// cancel detection that must not swallow a real connection error.
import {expect,it} from 'vitest';
import {CANCEL_NOTICE,SLOW_WAIT_MS,VERY_SLOW_WAIT_MS,WAIT_SUMMARY,elapsedLabel,isAbortError,waitHint} from './instantWait';

it('formats the elapsed clock as minutes and zero-padded seconds',()=>{
  expect(elapsedLabel(0)).toBe('0:00');
  expect(elapsedLabel(999)).toBe('0:00');
  expect(elapsedLabel(7000)).toBe('0:07');
  expect(elapsedLabel(61000)).toBe('1:01');
  expect(elapsedLabel(600000)).toBe('10:00');
  expect(elapsedLabel(3600000)).toBe('60:00');
});

it('never renders a broken clock for invalid or negative input',()=>{
  expect(elapsedLabel(-5)).toBe('0:00');
  expect(elapsedLabel(Number.NaN)).toBe('0:00');
  expect(elapsedLabel(Number.POSITIVE_INFINITY)).toBe('0:00');
});

it('moves the hint through the documented thresholds',()=>{
  expect(waitHint(0)).toBe('Measuring the roof and researching local prices…');
  expect(waitHint(SLOW_WAIT_MS-1)).toBe('Measuring the roof and researching local prices…');
  expect(waitHint(SLOW_WAIT_MS)).toMatch(/Still working/);
  expect(waitHint(VERY_SLOW_WAIT_MS-1)).toMatch(/Still working/);
  expect(waitHint(VERY_SLOW_WAIT_MS)).toMatch(/taking longer than usual/);
});

it('describes what happens without claiming a server stage finished',()=>{
  for(const hint of [WAIT_SUMMARY,waitHint(0),waitHint(SLOW_WAIT_MS),waitHint(VERY_SLOW_WAIT_MS),CANCEL_NOTICE]){
    expect(hint).not.toMatch(/\b(done|finished|complete|completed)\b/i);
  }
  expect(WAIT_SUMMARY).toMatch(/one to three minutes/);
  expect(CANCEL_NOTICE).toMatch(/answers are still here/);
});

it('recognises only a real abort as a cancel',()=>{
  const aborted=new Error('The operation was aborted.');
  aborted.name='AbortError';
  expect(isAbortError(aborted)).toBe(true);
  expect(isAbortError(new Error('Failed to fetch'))).toBe(false);
  expect(isAbortError({name:'TimeoutError'})).toBe(false);
  expect(isAbortError(null)).toBe(false);
  expect(isAbortError(undefined)).toBe(false);
  expect(isAbortError('AbortError')).toBe(false);
});
