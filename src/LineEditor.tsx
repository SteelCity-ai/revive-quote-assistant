import { Plus, Trash2 } from 'lucide-react';
import { money, newId } from './domain';
import type { Line } from './domain';

const UNITS = ['allowance', 'sq ft', 'linear ft', 'each', 'square', 'day', 'hr', 'exclusion'];

export const newMaterialLine = (laborRate: number): Line => ({ id: newId(), description: '', quantity: 1, unit: 'allowance', material: 0, hours: 0, rate: laborRate });
export const newLaborLine = (laborRate: number): Line => ({ id: newId(), description: '', quantity: 1, unit: 'hr', material: 0, hours: 1, rate: laborRate });
export const newExclusionLine = (laborRate: number): Line => ({ id: newId(), description: '', quantity: 1, unit: 'exclusion', material: 0, hours: 0, rate: laborRate });
const lineCost = (l: Line) => l.quantity * l.material + l.hours * l.rate;

export default function LineEditor({ lines, laborRate, change }: { lines: Line[]; laborRate: number; change: (lines: Line[]) => void }) {
  const edit = (id: string, patch: Partial<Line>) => change(lines.map(l => l.id === id ? { ...l, ...patch } : l));
  const add = (line: Line) => change([...lines, line]);
  return <div className="line-editor">
    {lines.map((line, index) => <div className="line-edit-row" key={line.id}>
      <div className="line-edit-head">
        <span className="line-number">{String(index + 1).padStart(2, '0')}</span>
        <input aria-label={`Line ${index + 1} description`} value={line.description} placeholder="Describe this line exactly as the customer should read it" onChange={e => edit(line.id, { description: e.target.value })}/>
        <button className="icon-button" aria-label={`Remove line ${index + 1}`} onClick={() => change(lines.filter(l => l.id !== line.id))}><Trash2 size={16}/></button>
      </div>
      {line.unit !== 'exclusion' ? <div className="line-edit-fields">
        <label className="field"><span>Qty</span><input type="number" min={0} step="any" aria-label={`Line ${index + 1} quantity`} value={Number.isFinite(line.quantity) ? line.quantity : 0} onChange={e => edit(line.id, { quantity: Number(e.target.value) })}/></label>
        <label className="field"><span>Unit</span><select aria-label={`Line ${index + 1} unit`} value={line.unit} onChange={e => edit(line.id, { unit: e.target.value })}>{UNITS.map(u => <option key={u}>{u}</option>)}</select></label>
        <label className="field"><span>Material $/unit</span><input type="number" min={0} step="0.01" aria-label={`Line ${index + 1} material cost per unit`} value={Number.isFinite(line.material) ? line.material : 0} onChange={e => edit(line.id, { material: Number(e.target.value) })}/></label>
        <label className="field"><span>Labor hrs</span><input type="number" min={0} step="any" aria-label={`Line ${index + 1} labor hours`} value={Number.isFinite(line.hours) ? line.hours : 0} onChange={e => edit(line.id, { hours: Number(e.target.value) })}/></label>
        <label className="field"><span>Rate $/hr</span><input type="number" min={0} step="0.01" aria-label={`Line ${index + 1} labor rate`} value={Number.isFinite(line.rate) ? line.rate : 0} onChange={e => edit(line.id, { rate: Number(e.target.value) })}/></label>
      </div> : <p className="fine-print">Excluded from this quote — wording only, no cost.</p>}
      <div className="line-edit-total"><small>Material: {money(line.quantity * line.material)} · Labor: {money(line.hours * line.rate)}{line.unit === 'allowance' ? ' · counts as an allowance' : line.unit === 'hr' ? ' · priced labor' : ''}</small><strong>{line.unit === 'exclusion' ? '—' : money(lineCost(line))}</strong></div>
    </div>)}
    <div className="line-add-buttons">
      <button className="secondary" onClick={() => add(newMaterialLine(laborRate))}><Plus size={16}/>Add material / subcontract line</button>
      <button className="secondary" onClick={() => add(newLaborLine(laborRate))}><Plus size={16}/>Add labor line (hrs × rate)</button>
      <button className="text-button" onClick={() => add(newExclusionLine(laborRate))}><Plus size={14}/>Add exclusion</button>
    </div>
    <p className="fine-print">A labor line is real priced labor (hours × rate), not an allowance. Every edit changes the quote — after a portal save, changes require a new approved revision to refresh the customer link.</p>
  </div>;
}
