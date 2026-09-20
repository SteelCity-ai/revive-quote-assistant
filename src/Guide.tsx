import { useEffect, useRef, useState } from 'react';
import { Check, Lightbulb, MapPinned, ArrowRight } from 'lucide-react';
import { Footer, QuoteAside, Stepper } from './components';
import { questions, validAnswer } from './domain';
import type { Quote } from './domain';
export default function Guide({ quote, update, exit, finish, connections }: { quote: Quote; update: (patch: Partial<Quote>) => void; exit: () => void; finish: () => void; connections: () => void }) {
  const list = questions(quote.type, quote.answers);
  const step = Math.min(quote.step, list.length - 1);
  const question = list[step];
  const value = quote.answers[question.id] ?? '';
  const heading = useRef<HTMLHeadingElement>(null);
  const [error, setError] = useState('');
  useEffect(() => { setError(''); heading.current?.focus(); window.scrollTo({ top: 0 }); }, [question.id]);
  const setAnswer = (answer: string | string[]) => { setError(''); update({ answers: { ...quote.answers, [question.id]: answer } }); };
  const next = () => { if (!validAnswer(question, value)) { setError(question.type === 'number' ? 'Enter a valid measurement, or choose “I’m not sure yet.”' : 'Add an answer to continue.'); return; } if (step === list.length - 1) finish(); else update({ step: step + 1 }); };
  return <><div className="workspace"><main className="guide"><Stepper stage="guide"/><div className="question-progress"><span>{question.section}</span><span>{step + 1} of {list.length}</span></div><div className="progress-track"><div style={{ width: `${(step+1)/list.length*100}%` }}/></div><section className="question"><h1 ref={heading} tabIndex={-1}>{question.title}</h1><p className="question-help" id="question-help">{question.help}</p>
    {question.id === 'measurementMode' && <button className="feature-callout" onClick={connections}><MapPinned size={22}/><span><strong>Automatic roof measurement</strong><small>Connect Google later. Manual measurements work now.</small></span><ArrowRight size={17}/></button>}
    <form onSubmit={e => { e.preventDefault(); next(); }}>
      {['text', 'textarea', 'number'].includes(question.type) && <label className="answer-field"><span className="sr-only">{question.title}</span>{question.type === 'textarea' ? <textarea aria-describedby="question-help" rows={5} value={value === 'Not sure yet' ? '' : String(value)} placeholder="Add the details here…" onChange={e => setAnswer(e.target.value)}/> : <div className="input-unit"><input type={question.type === 'number' ? 'number' : 'text'} inputMode={question.type === 'number' ? 'decimal' : 'text'} aria-describedby="question-help" autoComplete={question.id === 'address' ? 'street-address' : 'off'} min={['waste', 'pitch'].includes(question.id) ? 0 : 0.01} max={question.id === 'waste' ? 100 : question.id === 'pitch' ? 24 : undefined} step="any" value={value === 'Not sure yet' ? '' : String(value)} placeholder={question.type === 'number' ? 'Enter measurement' : 'Type your answer…'} onChange={e => setAnswer(e.target.value)}/>{question.unit && <span>{question.unit}</span>}</div>}</label>}
      {['choice', 'multi'].includes(question.type) && <div className="answer-options" role="group" aria-label={question.title}>{question.options?.map(option => { const selected = Array.isArray(value) ? value.includes(option) : value === option; return <button type="button" key={option} className={`answer-option ${selected ? 'selected' : ''}`} aria-pressed={selected} onClick={() => { if (question.type === 'multi') { const values = Array.isArray(value) ? value : []; setAnswer(selected ? values.filter(v => v !== option) : [...values, option]); } else setAnswer(option); }}><span>{option}</span><i className={question.type === 'multi' ? 'checkbox' : ''}>{selected && <Check size={15}/>}</i></button>; })}</div>}
      {question.unknown && <button type="button" className={`unknown-button ${value === 'Not sure yet' ? 'active' : ''}`} onClick={() => setAnswer(value === 'Not sure yet' ? '' : 'Not sure yet')}>{value === 'Not sure yet' && <Check size={15}/>}I’m not sure yet</button>}
      {question.optional && <p className="optional-note">Optional — continue to skip this question.</p>}
      {value === 'Not sure yet' && <p className="inline-note"><Lightbulb size={17}/>We’ll flag this for review. It won’t be treated as a confirmed detail.</p>}
      {error && <p role="alert" className="error">{error}</p>}
      <button type="submit" hidden aria-hidden="true" tabIndex={-1}>Continue</button>
    </form></section><button className="text-button save-exit" onClick={exit}>Save & return to quotes</button></main><QuoteAside quote={quote}/></div><Footer back={step === 0 ? exit : () => update({ step: step - 1 })} next={next} label={step === list.length - 1 ? 'Build estimate' : 'Continue'}/></>;
}
