import {it,expect,vi,afterEach} from 'vitest';
import {validOrigin} from '../src/lib/origin';
afterEach(()=>vi.unstubAllEnvs());
it('accepts an explicit public origin even when Next supplies an internal URL',()=>{
 vi.stubEnv('ALLOWED_ORIGINS','http://127.0.0.1:3000');
 expect(validOrigin(new Request('http://localhost:3000/api/cart',{headers:{Origin:'http://127.0.0.1:3000'}}))).toBe(true);
});
it('rejects absent, opaque and attacker origins',()=>{
 vi.stubEnv('ALLOWED_ORIGINS','https://shop.example.test');
 for(const origin of ['null','https://evil.example.test','https://shop.example.test.evil.test'])
  expect(validOrigin(new Request('https://shop.example.test/api/cart',{headers:{Origin:origin}}))).toBe(false);
 expect(validOrigin(new Request('https://shop.example.test/api/cart'))).toBe(false);
});
