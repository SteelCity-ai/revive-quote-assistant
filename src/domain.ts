import type { AIReport } from './ai';
import type { PortalSync } from './portal';
export type JobType = 'renovation' | 'roofing' | 'contracting';
export type Answers = Record<string, string | string[]>;
export type Line = { id: string; description: string; quantity: number; unit: string; material: number; hours: number; rate: number };
export type Pricing = { laborRate: number; markup: number; contingency: number; tax: number };
export type Quote = {
  id: string; type: JobType; createdAt: string; updatedAt: string; step: number;
  stage: 'guide' | 'pricing' | 'review'; answers: Answers; lines: Line[]; pricing: Pricing;
  exclusions: string; assumptions: string; terms: string; kind: 'estimate' | 'fixed';
  approvedAt?: string; acknowledged: boolean; ai?: AIReport; portal?: PortalSync;
};
export const jobNames: Record<JobType, string> = { renovation: 'Commercial renovation', roofing: 'Roofing', contracting: 'General contracting' };
export const defaults: Pricing = { laborRate: 0, markup: 15, contingency: 0, tax: 0 };
export const trades = ['Demolition', 'Framing & drywall', 'Painting & finishes', 'Flooring', 'Electrical', 'Plumbing', 'HVAC', 'Other specialty work'];
export type Question = { id: string; title: string; help: string; section: string; type: 'text' | 'textarea' | 'number' | 'choice' | 'multi'; options?: string[]; unit?: string; optional?: boolean; unknown?: boolean };
const q = (id: string, title: string, help: string, type: Question['type'], section: string, extra: Partial<Question> = {}): Question => ({ id, title, help, type, section, ...extra });
export const answerText = (a: Answers, key: string): string => typeof a[key] === 'string' ? a[key] as string : '';
export function questions(type: JobType, a: Answers): Question[] {
  const result: Question[] = [
    q('customer', 'Who is this quote for?', 'Enter the customer or company name. You can link a portal customer when the connection is available.', 'text', 'The job'),
    q('address', 'Where is the work?', 'Enter the full job address, including city and ZIP. This will also be used for roof lookup and local pricing.', 'text', 'The job'),
    q('title', 'Give this job a short name.', 'Something you’ll recognize later, like “Union Deposit office build-out.”', 'text', 'The job'),
    q('contact', 'How can you reach the customer?', 'Add an email address or phone number for your records. Nothing is sent from this version.', 'text', 'The job', { optional: true }),
  ];
  if (type === 'roofing') {
    result.push(
      q('roofWork', 'What does the roof need?', 'Choose the main scope. We’ll tailor the questions and estimate lines to it.', 'choice', 'Roof scope', { options: ['Replacement', 'Repair', 'Coating / restoration', 'New installation'] }),
      q('roofSystem', 'What roof system are we quoting?', 'For a replacement, select the proposed system. Record the existing system in the condition notes.', 'choice', 'Roof scope', { options: ['TPO / PVC membrane', 'EPDM membrane', 'Modified bitumen / built-up', 'Metal', 'Asphalt shingles', 'Other / not decided'], unknown: true }),
      q('measurementMode', 'How will we measure the work area?', 'Use only the roof sections included in this quote. Automatic roof measurement will be available after Google is connected.', 'choice', 'Measurements', { options: ['Measured roof surface area', 'Building footprint + roof pitch'], unknown: true }),
    );
    if (answerText(a, 'measurementMode') !== 'Not sure yet') {
      result.push(q('roofArea', 'How large is the area being quoted?', answerText(a, 'measurementMode') === 'Building footprint + roof pitch' ? 'Enter the horizontal footprint. We’ll use pitch to estimate roof surface area. For mixed pitches, use separately measured surface areas instead.' : 'Enter the actual roof surface area, including slope. For a repair, enter only the affected area.', 'number', 'Measurements', { unit: 'sq ft', unknown: true }));
      if (answerText(a, 'measurementMode') === 'Building footprint + roof pitch') result.push(q('pitch', 'What is the roof pitch?', 'Enter inches of rise per 12 inches of run. Use 0 for a flat roof, 4 for a 4:12 pitch.', 'number', 'Measurements', { unit: '/ 12', unknown: true }));
      result.push(q('measurementSource', 'Where did these measurements come from?', 'Keep a clear record of how the roof was measured.', 'choice', 'Measurements', { options: ['Google aerial imagery', 'Field measured', 'Plans / drawings', 'Aerial report', 'Rough estimate'], unknown: true }));
    }
    if (answerText(a, 'roofWork') === 'Replacement') result.push(q('layers', 'How many layers need to come off?', 'This affects labor, disposal and the condition of the exposed deck.', 'choice', 'Roof scope', { options: ['1 layer', '2 layers', '3 or more layers', 'Overlay — no tear-off'], unknown: true }));
    result.push(
      q('condition', 'What do we know about the existing roof?', 'Describe leaks, wet insulation, deck damage, drainage, and the existing system. Call out anything that still needs inspection.', 'textarea', 'Roof scope', { unknown: true }),
      q('details', 'What roof details need attention?', 'List drains, scuppers, penetrations, curbs, flashing and edge conditions. Include counts or lengths when known.', 'textarea', 'Roof scope', { unknown: true }),
      q('access', 'How will the crew access the roof?', 'Include building height, staging, lifts or cranes, tenant restrictions and disposal access.', 'textarea', 'Site conditions', { unknown: true }),
      q('waste', 'What material waste allowance should we use?', 'Enter a percentage based on the system and layout. Applied to primary roof material quantity only, not labor or tear-off.', 'number', 'Measurements', { unit: '%', unknown: true }),
    );
  } else {
    result.push(
      q('description', type === 'renovation' ? 'Walk us through the renovation.' : 'What are we building or fixing?', 'Describe the existing space, the intended result, and the work the customer expects.', 'textarea', 'Scope of work'),
      q('workArea', 'How much space is involved?', 'Enter the affected floor area when applicable. Each trade’s quantity can be refined in the estimate.', 'number', 'Measurements', { unit: 'sq ft', unknown: true }),
      q('trades', 'Which trades are part of the job?', 'Choose everything included. We’ll walk through each selected trade next.', 'multi', 'Scope of work', { options: trades }),
    );
    const selected = Array.isArray(a.trades) ? a.trades : [];
    for (const trade of selected) result.push(q(`trade:${trade}`, `Let’s define ${trade.toLowerCase()}.`, trade === 'Other specialty work' ? 'Name the specialty work, quantities, materials, and who will perform it.' : 'Describe what’s included, quantities or dimensions, finish expectations, and any subcontractor allowances.', 'textarea', 'Scope of work', { unknown: true }));
    result.push(q('occupied', 'Will the space be occupied during work?', 'This helps identify phasing, protection and working-hour requirements.', 'choice', 'Site conditions', { options: ['Vacant', 'Occupied — normal hours', 'Occupied — after hours / phased'], unknown: true }),
      q('access', 'What site restrictions should we allow for?', 'Include loading, parking, stairs or elevators, dust control, protection, working hours and disposal.', 'textarea', 'Site conditions', { unknown: true }));
  }
  result.push(q('schedule', 'When does the work need to happen?', 'Include a target start, deadline, or whether the schedule is flexible.', 'text', 'Finish the scope', { unknown: true }),
    q('permits', 'What about permits and inspections?', 'Confirm responsibility and add fees as estimate lines if included.', 'choice', 'Finish the scope', { options: ['Included in our scope', 'Customer / others responsible', 'Not required — verified'], unknown: true }),
    q('notes', 'Anything else we should capture?', 'Add warranties, special requirements, site-visit notes or customer requests. You can edit exclusions and terms before approval.', 'textarea', 'Finish the scope', { optional: true }));
  return result;
}
export function validAnswer(question: Question, value: string | string[] | undefined): boolean {
  if (question.optional && !value) return true;
  if (value === 'Not sure yet') return !!question.unknown;
  if (question.type === 'multi') return Array.isArray(value) && value.length > 0;
  if (typeof value !== 'string' || !value.trim()) return !!question.optional;
  if (question.type === 'number') {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 && (['pitch', 'waste'].includes(question.id) || n > 0) && (question.id !== 'waste' || n <= 100) && (question.id !== 'pitch' || n <= 24);
  }
  return true;
}
export function roofMeasurement(a: Answers): { area: number | null; materialArea: number | null; pitchAdjusted: boolean } {
  const footprint = answerText(a, 'measurementMode') === 'Building footprint + roof pitch';
  if (answerText(a, 'measurementMode') === 'Not sure yet') return { area: null, materialArea: null, pitchAdjusted: false };
  const raw = Number(a.roofArea);
  const pitch = footprint ? Number(a.pitch) : 0;
  if (!Number.isFinite(raw) || raw <= 0 || (footprint && (!answerText(a, 'pitch') || !Number.isFinite(pitch) || pitch < 0 || pitch > 24))) return { area: null, materialArea: null, pitchAdjusted: footprint };
  const area = raw * Math.sqrt(1 + (pitch / 12) ** 2);
  const waste = answerText(a, 'waste') ? Number(a.waste) : NaN;
  return { area, materialArea: Number.isFinite(waste) && waste >= 0 && waste <= 100 ? area * (1 + waste / 100) : null, pitchAdjusted: footprint };
}
export const newId = () => {
  if(globalThis.crypto?.randomUUID)return globalThis.crypto.randomUUID();
  const bytes=new Uint8Array(16);
  if(globalThis.crypto?.getRandomValues)globalThis.crypto.getRandomValues(bytes);else for(let i=0;i<16;i++)bytes[i]=Math.floor(Math.random()*256);
  bytes[6]=(bytes[6]!&15)|64;bytes[8]=(bytes[8]!&63)|128;
  const h=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;
};
export function makeQuote(type: JobType, pricing: Pricing): Quote {
  return { id: newId(), type, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), step: 0, stage: 'guide', answers: {}, lines: [], pricing: { ...pricing }, exclusions: '', assumptions: '', terms: '', kind: 'estimate', acknowledged: false };
}
export function initialLines(quote: Quote): Line[] {
  const a = quote.answers;
  const line = (description: string, quantity = 1, unit = 'allowance'): Line => ({ id: newId(), description, quantity, unit, material: 0, hours: 0, rate: quote.pricing.laborRate });
  if (quote.type === 'roofing') {
    const roof = roofMeasurement(a);
    const system = answerText(a, 'roofSystem');
    const repair = answerText(a, 'roofWork') === 'Repair';
    const lines = [line(`${system || 'Roof system'} — ${repair ? 'repair materials' : 'primary materials'}`, roof.materialArea ? Math.ceil(roof.materialArea) : 1, roof.materialArea ? 'sq ft' : 'allowance'), line(`${answerText(a, 'roofWork')} labor`), line('Flashing, edges & roof details')];
    if (answerText(a, 'roofWork') === 'Replacement' && answerText(a, 'layers') !== 'Overlay — no tear-off') lines.push(line('Tear-off & disposal', roof.area ? Math.ceil(roof.area) : 1, roof.area ? 'sq ft' : 'allowance'));
    return lines;
  }
  return (Array.isArray(a.trades) ? a.trades : []).map(trade => line(trade));
}
const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export function totals(lines: Line[], pricing: Pricing) {
  const materials = round(lines.reduce((s, l) => s + round(l.quantity * l.material), 0));
  const labor = round(lines.reduce((s, l) => s + round(l.hours * l.rate), 0));
  const direct = round(materials + labor);
  const contingency = round(direct * pricing.contingency / 100);
  const markup = round((direct + contingency) * pricing.markup / 100);
  const tax = round(materials * pricing.tax / 100);
  return { materials, labor, direct, contingency, markup, tax, total: round(direct + contingency + markup + tax) };
}
export function issues(quote: Quote): string[] {
  const missing = questions(quote.type, quote.answers).filter(question => !question.optional && (!validAnswer(question, quote.answers[question.id]) || quote.answers[question.id] === 'Not sure yet')).map(question => question.title);
  if (quote.type === 'roofing' && answerText(quote.answers, 'measurementSource') === 'Rough estimate') missing.push('Roof measurements are a rough estimate.');
  if (!quote.lines.length) missing.push('Add at least one priced line item.');
  for (const l of quote.lines) {
    if (!l.description.trim() || !Number.isFinite(l.quantity) || l.quantity <= 0 || [l.material, l.hours, l.rate].some(n => !Number.isFinite(n) || n < 0) || l.quantity * l.material + l.hours * l.rate <= 0 || (l.hours > 0 && l.rate <= 0)) missing.push(`Check quantity and pricing: ${l.description || 'Unnamed item'}`);
  }
  if (quote.kind === 'fixed' && (!quote.terms.trim() || !quote.exclusions.trim())) missing.push('Fixed quotes need terms and an explicit exclusions statement.');
  if (quote.ai) missing.push(...quote.ai.questions.filter((_,i)=>!quote.ai!.resolvedQuestions.includes(i)).map(q=>`AI follow-up: ${q}`));
  return missing;
}
export const money = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
