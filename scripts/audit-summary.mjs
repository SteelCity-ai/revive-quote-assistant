#!/usr/bin/env node
// Read-only spend/latency summary for the generation audit log.
// Usage: node scripts/audit-summary.mjs <path/to/generations.jsonl>
import {readFile} from 'node:fs/promises';
import {summarizeAudit} from '../server/audit.mjs';

const file=process.argv[2];
if(!file){
  console.error('Usage: node scripts/audit-summary.mjs <generations.jsonl>');
  process.exit(2);
}
let text;
try{
  text=await readFile(file,'utf8');
}catch(error){
  console.error(`Cannot read ${file}: ${error.code||'read error'}`);
  process.exit(1);
}
const summary=summarizeAudit(text.split('\n'));
console.log(JSON.stringify(summary,null,2));
