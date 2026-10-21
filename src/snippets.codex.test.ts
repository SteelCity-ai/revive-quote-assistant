import {it,expect} from 'vitest';
import {loadSnippets,saveSnippet,appendSnippetLines,snippetMoneySafe} from './snippets';
it('blocked storage reads return an honest typed error rather than crash',()=>{
 const st={getItem:()=>{throw new DOMException('Storage denied','SecurityError')},setItem:()=>{}};
 expect(()=>loadSnippets(st)).not.toThrow();
 expect(loadSnippets(st).ok).toBe(false);
});
it('append validates the combined resulting scope monetary safety',()=>{
 const data:Record<string,string>={};const st={getItem:(k:string)=>data[k]??null,setItem:(k:string,v:string)=>{data[k]=v}};
 const l={id:'original',description:'Synthetic large line',quantity:1,unit:'ea',material:5e13,hours:0,rate:0};
 expect(snippetMoneySafe([l])).toBe(true);
 const s=saveSnippet({name:'Synthetic',lines:[l]},st);expect(s.ok).toBe(true);if(!s.ok)throw Error('fixture failed');
 const a=appendSnippetLines(s.snippet.id,[l],st);
 if(a.ok)expect(snippetMoneySafe(a.lines)).toBe(true);
 else expect(a.error).toBe('invalid-input');
});
