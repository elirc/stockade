'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import {Package,ChevronRight,ArrowLeft} from 'lucide-react';
import {api,Row,User,Product,text,num,money,date,list} from '@/lib/client';
import {Badge,Empty,Loading,Notice} from './ui';
import OrderDetail from './OrderDetail';
export default function CustomerAccount(){
 const[user,setUser]=useState<User|null>(null),[orders,setOrders]=useState<Row[]>([]),[products,setProducts]=useState<Product[]>([]),[selected,setSelected]=useState<string|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[refresh,setRefresh]=useState(0);
 useEffect(()=>{api<User>('/me').then(setUser).catch(()=>window.location.href='/login');},[]);
 useEffect(()=>{if(!user)return;Promise.all([api<Row>('/data/orders?limit=100'),api<{items:Product[]}>('/catalog')]).then(([o,p])=>{setOrders(list(o,'items'));setProducts(p.items);}).catch(e=>setError(e.message)).finally(()=>setLoading(false));},[user,refresh]);
 return <div className="store-page"><header className="store-header"><Link href="/" className="store-brand">NORTHLINE<span>SUPPLY CO.</span></Link><Link className="text-link" href="/"><ArrowLeft size={17}/>Back to the store</Link></header><main id="main" className="account-main"><div className="eyebrow">YOUR NORTHLINE ACCOUNT</div><h1>Your orders</h1><p className="muted">Track deliveries, request returns, and keep everything in one place.</p>{error&&<Notice message={error} error/>}{loading?<Loading/>:orders.length===0?<Empty title="Your first adventure awaits" description="Orders you place will appear here."/>:<div className="customer-orders">{orders.map(o=><button key={text(o,'id')} className="customer-order" onClick={()=>setSelected(text(o,'id'))}><span className="product-swatch"><Package size={25}/></span><div><strong>{text(o,'number')}</strong><small>{date(text(o,'createdAt'))}</small></div><Badge state={text(o,'state')}/><strong>{money(num(o,'total'))}</strong><ChevronRight size={20}/></button>)}</div>}</main>{selected&&<OrderDetail id={selected} customer products={products} warehouses={[]} onClose={()=>setSelected(null)} onSaved={()=>setRefresh(v=>v+1)}/>}</div>;
}
