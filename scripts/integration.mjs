import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
const base=process.env.FULFIL_TEST_URL??'http://127.0.0.1:5080/api/v1';
const db=new pg.Pool({connectionString:process.env.TEST_DATABASE_URL??'postgresql://stockade:stockade_local_only@127.0.0.1:54329/stockade'});
const origin='http://127.0.0.1:3000';
const results=[];
let failure=null;
class Client{
 cookie='';
 async request(path,method='GET',body,key){
  const headers={'Content-Type':'application/json','Origin':origin,'Cookie':this.cookie};
  if(key)headers['Idempotency-Key']=key;
  const response=await fetch(base+path,{method,headers,body:body?JSON.stringify(body):undefined});
  for(const value of response.headers.getSetCookie())this.cookie=value.split(';')[0];
  let value;try{value=await response.json();}catch{value={error:await response.text()};}
  return {status:response.status,body:value};
 }
 async ok(path,method='GET',body,key){const r=await this.request(path,method,body,key);assert.ok(r.status<300,JSON.stringify({path,...r}));return r.body;}
 cmd(operation,payload,key=randomUUID()){return this.ok('/commands/'+operation,'POST',payload,key);}
}
async function check(name,fn){const start=performance.now();try{await fn();const row={name,status:'pass',durationMs:Math.round(performance.now()-start)};results.push(row);console.log('PASS',name,row.durationMs+'ms');}catch(error){results.push({name,status:'fail',durationMs:Math.round(performance.now()-start),error:error.message,cause:error.cause?.code});throw error;}}
async function waitOrder(client,id,check,timeout=120000){const end=Date.now()+timeout;while(Date.now()<end){const d=await client.ok('/orders/'+id);if(check(d.order))return d;await new Promise(r=>setTimeout(r,700));}throw new Error('Timed out waiting for order '+id);}
const admin=new Client(),customer=new Client(),other=new Client(),approver=new Client();
try{
 await admin.ok('/auth/login','POST',{email:'admin@northline.test',password:'Stockade-demo-2026!',merchant:'northline'});
 await customer.ok('/auth/register','POST',{email:'test-'+randomUUID()+'@example.test',name:'Integration Customer',password:'Test-password-2026!',merchant:'northline'});
 await other.ok('/auth/login','POST',{email:'admin@harbor.test',password:'Stockade-demo-2026!',merchant:'harbor'});
 const me=await admin.ok('/me');
 const wh=(await admin.ok('/data/warehouses')).items;
 const productId=randomUUID();const sku='TEST-'+randomUUID().slice(0,8);
 await db.query('INSERT INTO "Products" ("Id","MerchantId","Name","Sku","Variant","Category","Description","Color","Price","Active") VALUES ($1,$2,$3,$4,\'Test\',\'Test\',\'Synthetic integration fixture\',\'#345678\',1000,true)',[productId,me.merchantId,'Integration fixture',sku]);
 await admin.cmd('inventory.initialize',{productId});
 await admin.cmd('inventory.adjust',{productId,warehouseId:wh[0].id,quantity:200,reason:'Synthetic test opening stock'});
 const position=async(warehouseId)=>(await admin.ok('/data/inventory?q='+sku+'&limit=100')).items.find(i=>i.warehouseId===warehouseId);
 await check('tenant and customer authorization boundaries',async()=>{
  assert.ok(!(await other.ok('/data/inventory')).items.some(x=>x.productId===productId));
  const denied=await customer.request('/commands/inventory.adjust','POST',{productId,warehouseId:wh[0].id,quantity:1,reason:'Denied'},randomUUID());assert.equal(denied.status,403);
  const cross=await other.request('/commands/inventory.adjust','POST',{productId,warehouseId:wh[0].id,quantity:1,reason:'Denied'},randomUUID());assert.ok([404,422].includes(cross.status));
 });
 const checkout={lines:[{productId,quantity:2}],address:'1 Test Street, Portland OR 97201',paymentMethod:'sim_success',checkoutKey:randomUUID()};
 let orderId;
 await check('quote is non-mutating and checkout replays once',async()=>{
  const before=await position(wh[0].id);const quote=await customer.ok('/quote','POST',checkout);const after=await position(wh[0].id);assert.equal(after.reserved,before.reserved);
  const key=randomUUID();const payload={...checkout,expectedTotal:quote.total};const result=await customer.cmd('checkout',payload,key);const replay=await customer.cmd('checkout',payload,key);assert.equal(result.id,replay.id);orderId=result.id;
  assert.equal((await other.request('/orders/'+orderId)).status,404);
  const conflict=await customer.request('/commands/checkout','POST',{...payload,address:'Changed'},key);assert.equal(conflict.status,409);
  const paid=await waitOrder(customer,orderId,o=>o.paymentState==='captured');assert.equal(paid.order.captured,paid.order.total);
 });
 await check('partial fulfillment, claimed return quantities and one-time restock',async()=>{
  const data=await admin.ok('/orders/'+orderId);const allocation=data.reservations.find(x=>x.productId===productId);
  await admin.cmd('order.fulfill',{id:orderId,warehouseId:allocation.warehouseId,lines:[{productId,quantity:1}],carrier:'Test carrier',tracking:'TEST-'+randomUUID()});
  const requested=await customer.cmd('return.request',{orderId,lines:[{productId,quantity:1}],replacementProductId:productId,reason:'Test return'});
  const duplicate=await customer.request('/commands/return.request','POST',{orderId,lines:[{productId,quantity:1}],reason:'Duplicate claim'},randomUUID());assert.equal(duplicate.status,422);
  await admin.cmd('return.decide',{id:requested.id,approve:true,reason:'Approved test return'});
  const before=await position(allocation.warehouseId);const key=randomUUID();const input={id:requested.id,warehouseId:allocation.warehouseId,restock:true};
  await admin.cmd('return.receive',input,key);await admin.cmd('return.receive',input,key);const after=await position(allocation.warehouseId);assert.equal(after.onHand,before.onHand+1);
  await waitOrder(customer,orderId,o=>o.refunded>0&&o.refundPending===0);
 });
 await check('exchange quote is non-mutating and confirmation creates one priced replacement',async()=>{
  const original=await customer.ok('/orders/'+orderId);const request=original.returns.find(r=>r.replacementProductId);
  const before=await position(wh[0].id);
  const quote=await customer.ok('/exchange-quote','POST',{id:request.id});
  assert.equal((await position(wh[0].id)).reserved,before.reserved);
  assert.equal((await customer.ok('/orders/'+orderId)).returns.find(r=>r.id===request.id).exchangeOrderId,null);
  assert.equal((await customer.request('/commands/exchange.checkout','POST',{id:request.id,expectedTotal:quote.total+1},randomUUID())).body.code,'price_changed');
  const key=randomUUID(),payload={id:request.id,expectedTotal:quote.total,paymentMethod:'sim_success'};
  const result=await customer.cmd('exchange.checkout',payload,key);
  assert.equal((await customer.cmd('exchange.checkout',payload,key)).id,result.id);
  await waitOrder(customer,result.id,o=>o.paymentState==='captured');
 });
 await check('transfer conservation, partial receipt and duplicate delivery',async()=>{
  const transfer=await admin.cmd('transfer.create',{sourceId:wh[0].id,destinationId:wh[1].id,lines:[{productId,quantity:4}],reason:'Test rebalance'});
  const sourceBefore=await position(wh[0].id),destBefore=await position(wh[1].id);
  await admin.cmd('transfer.approve',{id:transfer.id});assert.equal((await position(wh[0].id)).held,sourceBefore.held+4);
  await admin.cmd('transfer.dispatch',{id:transfer.id});assert.equal((await position(wh[0].id)).onHand,sourceBefore.onHand-4);
  const key=randomUUID(),payload={id:transfer.id,lines:[{productId,quantity:2}]};
  await admin.cmd('transfer.receive',payload,key);await admin.cmd('transfer.receive',payload,key);assert.equal((await position(wh[1].id)).onHand,destBefore.onHand+2);
  await admin.cmd('transfer.loss',{id:transfer.id,lines:[{productId,quantity:2}],reason:'Documented synthetic transit loss'});
 });
 await check('supplier receipts add accepted quantities exactly once',async()=>{
  const supplier=(await admin.ok('/data/suppliers')).items[0];const purchase=await admin.cmd('purchase.create',{supplierId:supplier.id,warehouseId:wh[1].id,lines:[{productId,quantity:6,unitCost:400}]});
  await admin.cmd('purchase.approve',{id:purchase.id});const before=await position(wh[1].id);
  const payload={id:purchase.id,lines:[{productId,quantity:3}]},key=randomUUID();await admin.cmd('purchase.receive',payload,key);await admin.cmd('purchase.receive',payload,key);
  assert.equal((await position(wh[1].id)).onHand,before.onHand+3);
  assert.equal((await admin.request('/commands/purchase.receive','POST',{id:purchase.id,lines:[{productId,quantity:4}]},randomUUID())).status,409);
  await admin.cmd('purchase.cancel',{id:purchase.id,reason:'Remaining shipment cancelled in test'});
 });
 await check('cycle counts reject stale baselines and self-approval',async()=>{
  let count=await admin.cmd('count.create',{productId,warehouseId:wh[1].id});
  await admin.cmd('inventory.adjust',{productId,warehouseId:wh[1].id,quantity:1,reason:'Movement while counting'});
  assert.equal((await admin.request('/commands/count.submit','POST',{id:count.id,counted:count.expected,reason:'Stale'},randomUUID())).status,409);
  await admin.cmd('count.reject',{id:count.id,reason:'Recount required'});
  count=await admin.cmd('count.create',{productId,warehouseId:wh[1].id});
  await admin.cmd('count.submit',{id:count.id,counted:count.expected+1,reason:'Verified physical count'});
  assert.equal((await admin.request('/commands/count.approve','POST',{id:count.id},randomUUID())).status,403);
  const id=randomUUID(),email='approver-'+id+'@example.test';
  await db.query('INSERT INTO "Accounts" ("Id","MerchantId","Email","Name","PasswordHash","Role","Guest") SELECT $1,"MerchantId",$2,\'Test approver\',"PasswordHash",\'admin\',false FROM "Accounts" WHERE "Id"=$3',[id,email,me.id]);
  await approver.ok('/auth/login','POST',{email,password:'Stockade-demo-2026!',merchant:'northline'});
  await approver.cmd('count.approve',{id:count.id});
 });
 await check('concurrent refunds cannot exceed captured funds',async()=>{
  const remainingOrder=await admin.ok('/orders/'+orderId);
  const remaining=remainingOrder.order.captured-remainingOrder.order.refunded-remainingOrder.order.refundPending;
  const responses=await Promise.all([1,2].map(()=>admin.request('/commands/order.refund','POST',{id:orderId,amount:remaining,reason:'Concurrent refund test'},randomUUID())));
  assert.equal(responses.filter(r=>r.status===200).length,1);assert.equal(responses.filter(r=>r.status===422).length,1);
  await waitOrder(admin,orderId,o=>o.refunded===o.captured);
 });
 await check('refund health separates retryable and exhausted work by merchant',async()=>{
  const before=await admin.ok('/data/health'),otherBefore=await other.ok('/data/health');
  const retryable=randomUUID(),stuck=randomUUID();
  const lock=await db.connect();
  try{
   await lock.query('SELECT pg_advisory_lock(hashtextextended($1,0))',['refund:'+retryable]);
   await db.query('INSERT INTO "Refunds" ("Id","MerchantId","OrderId","Amount","Reason","State","Attempts","CreatedAt") VALUES ($1,$2,$3,1,\'Health fixture\',\'pending\',11,now()),($4,$2,$3,1,\'Health fixture\',\'pending\',12,now())',[retryable,me.merchantId,orderId,stuck]);
   const health=await admin.ok('/data/health'),otherAfter=await other.ok('/data/health');
   assert.equal(health.pendingRefunds,before.pendingRefunds+2);
   assert.equal(health.retryableRefunds,before.retryableRefunds+1);
   assert.equal(health.stuckRefunds,before.stuckRefunds+1);
   assert.deepEqual(
    {pendingRefunds:otherAfter.pendingRefunds,retryableRefunds:otherAfter.retryableRefunds,stuckRefunds:otherAfter.stuckRefunds},
    {pendingRefunds:otherBefore.pendingRefunds,retryableRefunds:otherBefore.retryableRefunds,stuckRefunds:otherBefore.stuckRefunds},
   );
  }finally{
   await db.query('DELETE FROM "Refunds" WHERE "Id" = ANY($1::uuid[])',[[retryable,stuck]]);
   await lock.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',['refund:'+retryable]);
   lock.release();
  }
 });
 await check('declined payment compensates its reservation',async()=>{
  const before=await position(wh[0].id);
  const failed=await customer.cmd('checkout',{lines:[{productId,quantity:1}],address:'Test address',checkoutKey:randomUUID(),paymentMethod:'sim_decline'});
  await waitOrder(customer,failed.id,o=>o.state==='payment_failed');
  const after=await position(wh[0].id);assert.equal(after.available,before.available);
 });
 await check('inventory ledger and commitment reconciliation is clean',async()=>{
  const result=await admin.ok('/reconcile','POST',{});assert.equal(result.differences,0,result.detailJson);
 });
 await check('API keys enforce scopes and immediate revocation',async()=>{
  const key=await admin.ok('/integrations/keys','POST',{name:'Integration read-only',scopes:['inventory:read']});
  const headers={Authorization:'Bearer '+key.key,'Content-Type':'application/json','Idempotency-Key':randomUUID()};
  assert.equal((await fetch(base+'/data/inventory',{headers})).status,200);
  const denied=await fetch(base+'/commands/inventory.adjust',{method:'POST',headers,body:JSON.stringify({productId,warehouseId:wh[0].id,quantity:1,reason:'Scope rejection'})});assert.equal(denied.status,403);
  await admin.ok('/integrations/keys/'+key.id+'/revoke','POST',{});
  assert.equal((await fetch(base+'/data/inventory',{headers})).status,401);
 });
 await check('stacking rules are deterministic and product-scoped',async()=>{
  const prefix=randomUUID().slice(0,8).toUpperCase();
  await admin.cmd('promotion.create',{code:prefix+'A',kind:'fixed',value:100,minimum:0,globalLimit:10,perCustomerLimit:10,days:1,stackable:true,priority:1,productId});
  await admin.cmd('promotion.create',{code:prefix+'B',kind:'percent',value:10,minimum:0,globalLimit:10,perCustomerLimit:10,days:1,stackable:true,priority:2,productId});
  const input={lines:[{productId,quantity:1}],address:'Pricing test',promotions:[prefix+'B',prefix+'A']};
  const first=await customer.ok('/quote','POST',input);
  const second=await customer.ok('/quote','POST',{...input,promotions:[prefix+'A',prefix+'B']});
  assert.equal(first.discount,190);assert.equal(second.total,first.total);
  await admin.cmd('promotion.create',{code:prefix+'X',kind:'fixed',value:1,globalLimit:10,perCustomerLimit:10,days:1,stackable:false});
  assert.equal((await customer.request('/quote','POST',{...input,promotions:[prefix+'A',prefix+'X']})).body.code,'promotion_stack');
 });
 await check('database rejects oversells and history rewrites',async()=>{
  await assert.rejects(db.query('UPDATE "Inventory" SET "Reserved"="OnHand"+1 WHERE "ProductId"=$1',[productId]),/inventory_conservation/);
  await assert.rejects(db.query('UPDATE "Adjustments" SET "Reason"=\'rewrite\' WHERE "ProductId"=$1',[productId]),/append-only/);
 });
 if(process.env.RUN_CONTENTION==='1'){
  await check('500 parallel one-unit checkouts of 100 units yield exactly 100 orders',async()=>{
   const hot=randomUUID(),hotSku='HOT-'+randomUUID().slice(0,8);
   await db.query('INSERT INTO "Products" ("Id","MerchantId","Name","Sku","Variant","Category","Description","Color","Price","Active") VALUES ($1,$2,\'Contention fixture\',$3,\'Hot\',\'Test\',\'500-request test\',\'#345678\',100,true)',[hot,me.merchantId,hotSku]);
   await admin.cmd('inventory.initialize',{productId:hot});await admin.cmd('inventory.adjust',{productId:hot,warehouseId:wh[0].id,quantity:100,reason:'Contention fixture'});
   const responses=await Promise.all(Array.from({length:500},()=>customer.request('/commands/checkout','POST',{lines:[{productId:hot,quantity:1}],address:'Contention test',checkoutKey:randomUUID(),paymentMethod:'sim_success'},randomUUID())));
   const counts={};for(const r of responses)counts[r.status]=(counts[r.status]??0)+1;console.log('Contention outcomes:',JSON.stringify(counts));
   assert.equal(responses.filter(r=>r.status===200).length,100);assert.equal(responses.filter(r=>r.body.code==='out_of_stock').length,400);
   const rows=await db.query('SELECT "OnHand","Reserved","Held" FROM "Inventory" WHERE "ProductId"=$1',[hot]);
   assert.ok(rows.rows.every(r=>r.OnHand-r.Reserved-r.Held>=0));
  });
 }
 console.log('ALL',results.length,'INTEGRATION CHECKS PASSED');
}catch(e){failure={message:e.message,cause:e.cause?.code};console.error('INTEGRATION FAILURE',e);process.exitCode=1;}finally{
 const fs=await import('node:fs/promises');await fs.mkdir('artifacts',{recursive:true});
 await fs.writeFile('artifacts/integration-results.json',JSON.stringify({at:new Date().toISOString(),base,status:failure?'failed':'passed',failure,results},null,2));await db.end();
}
