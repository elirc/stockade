import {it,expect,vi,afterEach} from 'vitest';
import {command} from '../src/lib/client';
afterEach(()=>vi.unstubAllGlobals());
it('retains a receipt key after an uncertain network result and starts a fresh intent after success',async()=>{
 const keys:string[]=[];
 const send=vi.fn(async (_url:unknown,init:RequestInit)=>{keys.push((init.headers as Record<string,string>)['Idempotency-Key']);if(keys.length===1)throw new TypeError('connection lost');return new Response(JSON.stringify({id:'receipt'}),{status:200});});
 vi.stubGlobal('fetch',send);
 const payload={id:crypto.randomUUID(),lines:[{productId:crypto.randomUUID(),quantity:2}]};
 await expect(command('purchase.receive',payload)).rejects.toThrow('connection lost');
 await command('purchase.receive',payload);await command('purchase.receive',payload);
 expect(keys[0]).toBe(keys[1]);expect(keys[2]).not.toBe(keys[1]);
});
