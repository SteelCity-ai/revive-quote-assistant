import {it,expect} from 'vitest';
import {comparisonRange} from './ai';
import type {AIReport} from './ai';
it('excludes component prices and unknown project areas from full-scope cost comparisons',()=>{
 const base={label:'Guide',kind:'cost-guide' as const,location:'PA',low:100,high:200,sourceId:'S1',notes:''};
 const report={benchmarks:[{...base,unit:'sq ft',projectArea:null,scopeMatch:'component'},{...base,unit:'total',projectArea:null,scopeMatch:'whole-project'},{...base,low:10000,high:20000,unit:'total',projectArea:1000,scopeMatch:'whole-project'}]} as AIReport;
 expect(comparisonRange(report)).toEqual([{low:10,high:20}]);
});
