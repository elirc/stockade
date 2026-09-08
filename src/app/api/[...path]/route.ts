import { NextRequest, NextResponse } from 'next/server';
import { fulfil } from '@/lib/db';
export const dynamic = 'force-dynamic';
async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const target = fulfil() + '/api/v1/' + path.map(encodeURIComponent).join('/') + request.nextUrl.search;
  const headers = new Headers();
  for (const name of ['cookie','content-type','origin','idempotency-key','traceparent','tracestate','stripe-signature']) { const value=request.headers.get(name); if(value)headers.set(name,value); }
  try {
    const response=await fetch(target,{method:request.method,headers,body:['GET','HEAD'].includes(request.method)?undefined:await request.arrayBuffer(),cache:'no-store',signal:AbortSignal.timeout(35000),redirect:'manual'});
    const result=new NextResponse(response.body,{status:response.status});
    result.headers.set('Content-Type',response.headers.get('content-type')??'application/json');
    result.headers.set('Cache-Control','no-store');
    for(const cookie of response.headers.getSetCookie())result.headers.append('Set-Cookie',cookie);
    return result;
  } catch { return NextResponse.json({error:'Fulfil is temporarily unavailable. Please try again.',code:'service_unavailable'},{status:503}); }
}
export {proxy as GET,proxy as POST,proxy as PATCH,proxy as DELETE};
