/** Server-only v1 client. Keep keys out of browser bundles. */
export type QuantityLine={productId:string;quantity:number};
export interface CommandInputs {
 'order.fulfill':{id:string;warehouseId:string;lines:QuantityLine[];carrier:string;tracking:string};
 'order.cancel':{id:string;reason:string};'order.refund':{id:string;amount:number;reason:string};
 'order.reallocate':{id:string};
 'inventory.adjust':{productId:string;warehouseId:string;quantity:number;reason:string};
 'inventory.policy':{productId:string;warehouseId:string;reorderPoint:number;reorderTarget:number};
 'transfer.create':{sourceId:string;destinationId:string;lines:QuantityLine[];reason:string};
 'transfer.approve':{id:string};'transfer.dispatch':{id:string};'transfer.receive':{id:string;lines:QuantityLine[]};
 'transfer.cancel':{id:string;reason:string};'transfer.loss':{id:string;lines:QuantityLine[];reason:string};
 'count.create':{productId:string;warehouseId:string;assignedTo?:string};
 'count.submit':{id:string;counted:number;reason:string};'count.approve':{id:string};'count.reject':{id:string;reason:string};
 'supplier.create':{name:string;email:string;leadDays:number};
 'purchase.create':{supplierId:string;warehouseId:string;lines:Array<QuantityLine & {unitCost:number}>};
 'purchase.approve':{id:string};'purchase.receive':{id:string;lines:QuantityLine[]};'purchase.cancel':{id:string;reason:string};
 'return.decide':{id:string;approve:boolean;reason:string};'return.receive':{id:string;warehouseId:string;restock:boolean};
}
export class StockadeError extends Error {
 constructor(public status:number,public code:string,message:string,public traceId?:string){super(message);this.name='StockadeError';}
}
export class StockadeClient {
 constructor(private baseUrl:string,private apiKey:string,private fetcher:typeof fetch=fetch){}
 read<T>(resource:string,query:Record<string,string>={}):Promise<T>{
  if(!/^[a-z]+$/.test(resource))throw new Error('Invalid resource');
  return this.request<T>('/data/'+resource+'?'+new URLSearchParams(query));
 }
 order<T>(id:string):Promise<T>{return this.request<T>('/orders/'+encodeURIComponent(id));}
 command<K extends keyof CommandInputs,T=Record<string,unknown>>(operation:K,input:CommandInputs[K],idempotencyKey:string):Promise<T>{
  if(idempotencyKey.length<8)throw new Error('Persist a command key before sending.');
  return this.request<T>('/commands/'+operation,{method:'POST',headers:{'Idempotency-Key':idempotencyKey},body:JSON.stringify(input)});
 }
 private async request<T>(path:string,init:RequestInit={}):Promise<T>{
  const response=await this.fetcher(this.baseUrl.replace(/\/$/,'')+'/api/v1'+path,{...init,headers:{Authorization:'Bearer '+this.apiKey,'Content-Type':'application/json',...init.headers},signal:AbortSignal.timeout(35000)});
  const data=await response.json();
  if(!response.ok)throw new StockadeError(response.status,data.code??'http_error',data.error??'Stockade request failed',data.traceId);
  return data as T;
 }
}
