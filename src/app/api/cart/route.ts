import { NextRequest,NextResponse } from 'next/server';
import {db,validOrigin} from '@/lib/db';
import {z} from 'zod';
export const dynamic='force-dynamic';
const idSchema=z.string().uuid();
const cartSchema=z.object({merchant:z.string().max(60).default('northline'),lines:z.array(z.object({productId:z.string().uuid(),quantity:z.number().int().min(1).max(100)})).max(100)});
export async function GET(request:NextRequest){
  const id=idSchema.safeParse(request.cookies.get('stockade_cart')?.value);
  if(!id.success)return NextResponse.json({lines:[]});
  try{const result=await db.query('SELECT "LinesJson" as lines FROM "Carts" WHERE "Id"=$1',[id.data]);return NextResponse.json(result.rows[0]??{lines:[]});}
  catch{return NextResponse.json({error:'Cart is temporarily unavailable.'},{status:503});}
}
export async function PUT(request:NextRequest){
  if(!validOrigin(request))return NextResponse.json({error:'Untrusted origin.'},{status:403});
  const parsed=cartSchema.safeParse(await request.json());
  if(!parsed.success)return NextResponse.json({error:'Cart quantities are invalid.'},{status:422});
  if(new Set(parsed.data.lines.map(x=>x.productId)).size!==parsed.data.lines.length)return NextResponse.json({error:'Duplicate products are not allowed.'},{status:422});
  const existing=idSchema.safeParse(request.cookies.get('stockade_cart')?.value);
  const id=existing.success?existing.data:crypto.randomUUID();
  try{
    const merchant=await db.query('SELECT "Id" FROM "Merchants" WHERE "Slug"=$1',[parsed.data.merchant]);
    if(!merchant.rows[0])return NextResponse.json({error:'Store not found.'},{status:404});
    const merchantId=merchant.rows[0].Id as string;
    if(parsed.data.lines.length){
      const products=await db.query('SELECT "Id" FROM "Products" WHERE "MerchantId"=$1 AND "Id"=ANY($2::uuid[]) AND "Active"',[merchantId,parsed.data.lines.map(x=>x.productId)]);
      if(products.rowCount!==parsed.data.lines.length)return NextResponse.json({error:'A product is unavailable in this store.'},{status:422});
    }
    await db.query('INSERT INTO "Carts" ("Id","MerchantId","LinesJson") VALUES ($1,$2,$3::jsonb) ON CONFLICT ("Id") DO UPDATE SET "LinesJson"=EXCLUDED."LinesJson","MerchantId"=EXCLUDED."MerchantId","UpdatedAt"=now()',[id,merchantId,JSON.stringify(parsed.data.lines)]);
    const response=NextResponse.json({lines:parsed.data.lines});
    response.cookies.set('stockade_cart',id,{httpOnly:true,sameSite:'strict',secure:request.nextUrl.protocol==='https:',maxAge:60*60*24*30,path:'/'});
    return response;
  }catch{return NextResponse.json({error:'Could not save your cart.'},{status:503});}
}
