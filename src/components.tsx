import { ArrowLeft, ArrowRight, Check, Home as HomeIcon, Settings, Save } from 'lucide-react';
import type { ReactNode } from 'react';
import { jobNames, money, totals } from './domain';
import type { Quote } from './domain';
export function Header({ home, settings, saved }: { home: () => void; settings: () => void; saved: boolean }) {
  return <header className="header"><button className="brand" onClick={home} aria-label="Revive Quote Assistant home"><span className="brand-symbol"><HomeIcon size={23}/></span><span><b>REVIVE</b><small>QUOTE ASSISTANT</small></span></button><div className="header-actions"><span className="saved-state"><Save size={13}/>{saved ? 'Saved on this device' : 'Device storage unavailable'}</span><button className="icon-button" onClick={settings} aria-label="Pricing and connections"><Settings size={21}/></button></div></header>;
}
export function Footer({ back, next, label = 'Continue', disabled = false, extra }: { back?: () => void; next: () => void; label?: string; disabled?: boolean; extra?: ReactNode }) {
  return <footer className="action-bar"><div>{back && <button className="secondary back" onClick={back}><ArrowLeft size={18}/><span>Back</span></button>}{extra}<button className="primary" onClick={next} disabled={disabled}>{label}<ArrowRight size={19}/></button></div></footer>;
}
export function Stepper({ stage }: { stage: 'guide' | 'pricing' | 'review' }) {
  const index = ['guide', 'pricing', 'review'].indexOf(stage);
  return <nav className="stepper" aria-label="Quote stages">{['Scope', 'Pricing', 'Review'].map((s, i) => <span key={s} className={i === index ? 'current' : i < index ? 'complete' : ''}><i>{i < index ? <Check size={13}/> : i + 1}</i>{s}{i < 2 && <span className="step-line"/>}</span>)}</nav>;
}
export function QuoteAside({ quote }: { quote: Quote }) {
  const t = totals(quote.lines, quote.pricing);
  return <aside className="quote-aside"><span className="section-label">YOUR QUOTE</span><h3>{String(quote.answers.title || 'Taking shape, one step at a time.')}</h3><p>{jobNames[quote.type]}</p><dl><div><dt>Customer</dt><dd>{String(quote.answers.customer || 'Not added yet')}</dd></div><div><dt>Job location</dt><dd>{String(quote.answers.address || 'Not added yet')}</dd></div></dl>{quote.lines.length > 0 && <div className="aside-total"><span>Current estimate</span><strong>{money(t.total)}</strong><small>{quote.approvedAt ? 'Approved quote' : 'Draft · review before approval'}</small></div>}<div className="aside-note"><Save size={17}/><p>Your progress is saved in this browser. You can leave and pick up where you stopped.</p></div></aside>;
}
export function NumberField({ label, value, change, suffix, max, min = 0 }: { label: string; value: number; change: (n: number) => void; suffix?: string; max?: number; min?: number }) {
  return <label className="field"><span>{label}</span><div className="input-unit"><input aria-label={label} type="number" inputMode="decimal" min={min} max={max} step="any" value={value === 0 ? '' : value} placeholder="0" onChange={e => { const n = Number(e.target.value); if (Number.isFinite(n) && n >= min && (max === undefined || n <= max)) change(n); }}/>{suffix && <span>{suffix}</span>}</div></label>;
}
