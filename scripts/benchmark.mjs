import pg from 'pg';
import {randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
const database=process.env.DATABASE_URL;
if(!database||!new URL(database).pathname.endsWith('_bench'))throw new Error('Set DATABASE_URL to an isolated database whose name ends in _bench. Point both API instances at that same database.');
const bases=(process.env.BENCH_API_URLS??'http://127.0.0.1:5080').split(',');
const pool=new pg.Pool({connectionString:database,max:5});
const origin='http://127.0.0.1:3000',run=randomUUID(),started=new Date().toISOString();
let cookie='';
async function api(path,body,base=bases[0]){
 const response=await fetch(base+'/api/v1'+path,{method:body?'POST':'GET',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json','Idempotency-Key':randomUUID()},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(120000)});
 const set=response.headers.getSetCookie();if(set.length)cookie=set[0].split(';')[0];
 const data=await response.json();return {status:response.status,body:data};
}
const percentile=(values,p)=>values.length?[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1]:null;
const summary=values=>({count:values.length,p50:percentile(values,.5),p95:percentile(values,.95),max:values.length?Math.max(...values):null});
try{
 const login=await api('/auth/login',{email:'admin@northline.test',password:'Stockade-demo-2026!',merchant:'northline'});
 if(login.status!==200)throw new Error('Benchmark login failed');
 const merchant=login.body.merchantId;
 const template=(await pool.query('SELECT "Id" FROM "Products" WHERE "MerchantId"=$1 ORDER BY "Id" LIMIT 1',[merchant])).rows[0];
 if(!template)throw new Error('Start the API with Development seeding first.');
 if(process.env.BENCH_SEED==='1'){
  const seedStart=performance.now();
  await pool.query('INSERT INTO "Products" SELECT (jsonb_populate_record(NULL::"Products",to_jsonb(p)||jsonb_build_object(\'Id\',md5(\'bench-product-\'||n)::uuid,\'Sku\',\'BENCH-\'||lpad(n::text,6,\'0\'),\'Name\',\'Benchmark product \'||n,\'Category\',\'Benchmark\',\'Price\',100))).* FROM "Products" p CROSS JOIN generate_series(1,200000) n WHERE p."Id"=$1 ON CONFLICT DO NOTHING',[template.Id]);
  await pool.query('INSERT INTO "Inventory" SELECT (jsonb_populate_record(NULL::"Inventory",to_jsonb(i)||jsonb_build_object(\'Id\',md5(p."Id"::text||w."Id"::text)::uuid,\'ProductId\',p."Id",\'WarehouseId\',w."Id",\'OnHand\',CASE WHEN p."Sku"<=\'BENCH-000020\' THEN 25 ELSE 0 END,\'Reserved\',0,\'Held\',0,\'Version\',0))).* FROM (SELECT * FROM "Inventory" WHERE "MerchantId"=$1 LIMIT 1) i CROSS JOIN "Products" p CROSS JOIN "Warehouses" w WHERE p."MerchantId"=$1 AND p."Sku" LIKE \'BENCH-%\' AND w."MerchantId"=$1 ON CONFLICT DO NOTHING',[merchant]);
  await pool.query('INSERT INTO "Adjustments" ("Id","MerchantId","ProductId","WarehouseId","Quantity","Reason","Reference","ActorId","CreatedAt") SELECT md5(\'bench-opening-\'||i."Id"::text)::uuid,i."MerchantId",i."ProductId",i."WarehouseId",25,\'Benchmark opening balance\',\'bench-seed\',NULL,now() FROM "Inventory" i JOIN "Products" p ON p."Id"=i."ProductId" WHERE p."MerchantId"=$1 AND p."Sku" BETWEEN \'BENCH-000001\' AND \'BENCH-000020\' ON CONFLICT DO NOTHING',[merchant]);
  let order=(await pool.query('SELECT "Id" FROM "Orders" WHERE "MerchantId"=$1 LIMIT 1',[merchant])).rows[0];
  if(!order){const accepted=await api('/commands/checkout',{lines:[{productId:template.Id,quantity:1}],address:'Benchmark seed address',checkoutKey:randomUUID(),paymentMethod:'sim_success'});if(accepted.status!==200)throw new Error('Could not create history template');order={Id:accepted.body.id};}
  await pool.query('INSERT INTO "Orders" SELECT (jsonb_populate_record(NULL::"Orders",to_jsonb(o)||jsonb_build_object(\'Id\',md5(\'bench-history-\'||n)::uuid,\'CheckoutKey\',\'bench-history-\'||n,\'Number\',\'BH-\'||n,\'State\',\'closed\',\'PaymentState\',\'captured\',\'FulfillmentState\',\'fulfilled\',\'Captured\',o."Total",\'Refunded\',0,\'RefundPending\',0,\'ProviderId\',NULL,\'ClientSecret\',NULL,\'CreatedAt\',now()-(n%730)*interval \'1 day\'-(n%86400)*interval \'1 second\',\'UpdatedAt\',now()))).* FROM "Orders" o CROSS JOIN generate_series(1,3000000) n WHERE o."Id"=$1 ON CONFLICT DO NOTHING',[order.Id]);
  await pool.query('ANALYZE');console.log('Seed duration ms',performance.now()-seedStart);
 }
 const counts=await pool.query('SELECT (SELECT count(*) FROM "Orders") orders,(SELECT count(*) FROM "Products") products,(SELECT count(*) FROM "Inventory") positions');
 if(Number(counts.rows[0].orders)<3000000||Number(counts.rows[0].products)<200000)throw new Error('Full dataset missing. Run BENCH_SEED=1 on this isolated database first.');
 const hot=(await pool.query('SELECT "Id" FROM "Products" WHERE "MerchantId"=$1 AND "Sku" BETWEEN \'BENCH-000001\' AND \'BENCH-000020\' ORDER BY "Sku"',[merchant])).rows;
 const available=(await pool.query('SELECT sum("OnHand"-"Reserved"-"Held")::integer units FROM "Inventory" WHERE "ProductId"=ANY($1::uuid[])',[hot.map(p=>p.Id)])).rows[0].units;
 if(hot.length!==20||available!==2000)throw new Error('This protocol needs a fresh 20-SKU dataset with 100 units each; restore a fresh benchmark snapshot before another run.');
 for(let i=0;i<20;i++)await api('/data/orders?limit=25&page=1');
 const begin=performance.now(),accepted=[],soldOut=[],errors=[],complete=[],samples=[],admin=[];
 const listProbe=(async()=>{for(let i=0;i<100;i++){const t=performance.now();const result=await api('/data/orders?limit=25&page='+(1+i%20));admin.push({ms:performance.now()-t,status:result.status});}})();
 await Promise.all(Array.from({length:5000},async(_,i)=>{
  const t=performance.now();
  try{
   const r=await api('/commands/checkout',{lines:[{productId:hot[i%20].Id,quantity:1}],address:'Benchmark fixture',checkoutKey:run+':'+i,paymentMethod:'sim_success'},bases[i%bases.length]);
   const ms=performance.now()-t;
   if(r.status===200){accepted.push(ms);samples.push({id:r.body.id,start:t});}
   else if(r.body.code==='out_of_stock')soldOut.push(ms);
   else errors.push({ms,status:r.status,code:r.body.code});
  }catch(e){errors.push({ms:performance.now()-t,code:e.name});}
 }));
 await listProbe;
 const deadline=performance.now()+600000,pending=new Map(samples.map(s=>[s.id,s]));
 while(pending.size&&performance.now()<deadline){
  const rows=await pool.query('SELECT "Id","PaymentState" FROM "Orders" WHERE "Id"=ANY($1::uuid[])',[Array.from(pending.keys())]);
  for(const row of rows.rows)if(['captured','failed','voided','expired'].includes(row.PaymentState)){const sample=pending.get(row.Id);complete.push({ms:performance.now()-sample.start,state:row.PaymentState});pending.delete(row.Id);}
  if(pending.size)await new Promise(r=>setTimeout(r,1000));
 }
 const balances=await pool.query('SELECT "OnHand","Reserved","Held" FROM "Inventory" WHERE "ProductId"=ANY($1::uuid[])',[hot.map(p=>p.Id)]);
 const invalid=balances.rows.filter(r=>r.OnHand-r.Reserved-r.Held<0).length;
 const report={protocol:'stockade-full-v1',run,started,finished:new Date().toISOString(),environment:{platform:os.platform(),cpus:os.cpus().length,memory:os.totalmem(),apiInstances:bases.length,node:process.version,provider:'Simulator',dataset:counts.rows[0]},acceptance:summary(accepted),soldOut:summary(soldOut),errors,completion:summary(complete.filter(x=>x.state==='captured').map(x=>x.ms)),completionStates:complete.reduce((a,x)=>(a[x.state]=(a[x.state]??0)+1,a),{}),timedOut:pending.size,admin:summary(admin.filter(x=>x.status===200).map(x=>x.ms)),adminErrors:admin.filter(x=>x.status!==200),invalidInventoryPositions:invalid,throughputAttemptsPerSecond:5000/((performance.now()-begin)/1000),limits:{checkoutP95Ms:800,orderListP95Ms:300},resourceMeasurements:'Collect host/container CPU, RSS and I/O externally; hardware capacity alone is not consumption.',expiryLag:'Separate expiry drill required.'};
 await mkdir('artifacts',{recursive:true});await writeFile('artifacts/benchmark-results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
 if(bases.length!==2||complete.filter(x=>x.state==='captured').length!==2000||invalid||accepted.length!==2000||soldOut.length!==3000||errors.length||pending.size||report.completion.p95>=800||report.admin.p95>=300)process.exitCode=1;
}finally{await pool.end();}
