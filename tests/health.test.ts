import {describe,expect,it} from 'vitest';
import {healthStats} from '../src/lib/health';

describe('operational health presentation',()=>{
 it('separates retryable refunds from exhausted refunds and keeps recovery guidance',()=>{
  const stats=healthStats({stuckSagas:2,pendingRefunds:5,retryableRefunds:3,stuckRefunds:2,deadLetters:1,items:[{differences:0}]});
  expect(stats).toEqual(expect.arrayContaining([
   {label:'Retryable refunds',value:3},
   {label:'Refunds needing retry',value:2,help:expect.stringContaining('Retry refund')},
  ]));
  expect(stats.find(x=>x.label==='Latest inventory differences')?.value).toBe(0);
 });
});
