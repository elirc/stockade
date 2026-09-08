import {describe,it,expect} from 'vitest';
import {money,jsonLines} from '../src/lib/client';
describe('customer financial display',()=>{
 it('formats minor units without accidentally charging whole dollars',()=>{expect(money(895)).toBe('$8.95');expect(money(0)).toBe('$0.00');});
 it('handles absent line snapshots as an empty list',()=>{expect(jsonLines({})).toEqual([]);});
});
