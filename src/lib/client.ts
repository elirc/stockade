export type Row=Record<string,unknown>;
export type User={id:string;merchantId:string;name:string;email:string;role:string;guest:boolean;warehouseId:string|null};
export type Product={id:string;merchantId:string;name:string;sku:string;variant:string;category:string;description:string;color:string;price:number;available:number};
export const text=(row:Row,key:string,fallback='')=>typeof row[key]==='string'?row[key] as string:fallback;
export const num=(row:Row,key:string)=>typeof row[key]==='number'?row[key] as number:0;
export const money=(cents:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(cents/100);
export const date=(value:string)=>new Date(value).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
export const list=(row:Row,key:string):Row[]=>Array.isArray(row[key])?row[key] as Row[]:[];
export const jsonLines=(row:Row,key='linesJson'):Row[]=>{try{return JSON.parse(text(row,key,'[]')) as Row[];}catch{return [];}};
export class ApiError extends Error {constructor(message:string,public status:number,public code:string){super(message);}}
export async function api<T>(path:string,options?:RequestInit):Promise<T>{
  const response=await fetch('/api'+path,{...options,headers:{'Content-Type':'application/json',...options?.headers}});
  const body=await response.json();
  if(!response.ok)throw new ApiError(body.error??'Something went wrong.',response.status,body.code??'request_failed');
  return body as T;
}
const pendingKeys=new Map<string,string>();
function canonical(value:unknown):string {
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 if(value&&typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',')+'}';
 return JSON.stringify(value)??'null';
}
export async function command<T=Row>(operation:string,payload:Row,key?:string):Promise<T>{
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(operation+':'+canonical(payload))))).map(b=>b.toString(16).padStart(2,'0')).join('');
 const storageKey='stockade-command:'+digest;
 let saved=pendingKeys.get(storageKey);
 try{saved=saved??sessionStorage.getItem(storageKey)??undefined;}catch{}
 const commandKey=key??saved??crypto.randomUUID();
 pendingKeys.set(storageKey,commandKey);try{sessionStorage.setItem(storageKey,commandKey);}catch{}
 const clear=()=>{pendingKeys.delete(storageKey);try{sessionStorage.removeItem(storageKey);}catch{}};
 try{
  const result=await api<T>('/commands/'+operation,{method:'POST',headers:{'Idempotency-Key':commandKey},body:JSON.stringify(payload)});
  clear();return result;
 }catch(error){
  // A network/5xx outcome may already have committed. Retain its key across form retries/reloads.
  if(error instanceof ApiError&&error.status<500&&error.status!==429)clear();
  throw error;
 }
}
