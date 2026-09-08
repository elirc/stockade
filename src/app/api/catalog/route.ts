import { NextRequest, NextResponse } from 'next/server';
import { db, fulfil, validOrigin } from '@/lib/db';
import { z } from 'zod';
export const dynamic='force-dynamic';
export async function GET(request:NextRequest) {
  try {
    const slug=request.nextUrl.searchParams.get('merchant')??'northline';
    const search=(request.nextUrl.searchParams.get('q')??'').slice(0,100);
    const category=request.nextUrl.searchParams.get('category')??'';
    const result=await db.query(
      'SELECT p."Id" as id,p."MerchantId" as "merchantId",p."Name" as name,p."Sku" as sku,p."Variant" as variant,p."Category" as category,p."Description" as description,p."Color" as color,p."Price"::float8 as price,COALESCE(SUM(CASE WHEN w."Active" THEN i."OnHand"-i."Reserved"-i."Held" ELSE 0 END),0)::int as available FROM "Products" p JOIN "Merchants" m ON p."MerchantId"=m."Id" LEFT JOIN "Inventory" i ON i."ProductId"=p."Id" AND i."MerchantId"=p."MerchantId" LEFT JOIN "Warehouses" w ON w."Id"=i."WarehouseId" WHERE m."Slug"=$1 AND p."Active" AND ($2=\'\' OR to_tsvector(\'english\',p."Name"||\' \'||p."Sku"||\' \'||p."Category") @@ plainto_tsquery(\'english\',$2)) AND ($3=\'\' OR p."Category"=$3) GROUP BY p."Id" ORDER BY p."Name",p."Variant" LIMIT 200',
      [slug,search,category]);
    return NextResponse.json({items:result.rows});
  }catch{return NextResponse.json({error:'Catalog is unavailable while the database starts.'},{status:503});}
}
const schema=z.object({name:z.string().min(1).max(150),sku:z.string().min(1).max(60),variant:z.string().max(100).default('Standard'),category:z.string().min(1).max(80),description:z.string().max(2000).default(''),price:z.number().int().min(1).max(10000000),color:z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#547684')});
export async function POST(request:NextRequest) {
  if(!validOrigin(request))return NextResponse.json({error:'Untrusted origin.'},{status:403});
  const auth=await fetch(fulfil()+'/api/v1/me',{headers:{cookie:request.headers.get('cookie')??''},cache:'no-store'});
  if(!auth.ok)return NextResponse.json({error:'Sign in.'},{status:401});
  const user=await auth.json() as {role:string;merchantId:string};
  if(!['owner','admin'].includes(user.role))return NextResponse.json({error:'Administrator access required.'},{status:403});
  const input=schema.safeParse(await request.json());
  if(!input.success)return NextResponse.json({error:input.error.issues[0].message},{status:422});
  const p=input.data;const id=crypto.randomUUID();
  try {
    await db.query('INSERT INTO "Products" ("Id","MerchantId","Name","Sku","Variant","Category","Description","Price","Color","Active") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true)',[id,user.merchantId,p.name,p.sku,p.variant,p.category,p.description,p.price,p.color]);
    return NextResponse.json({id},{status:201});
  }catch{return NextResponse.json({error:'Could not save the product. Check whether the SKU already exists.'},{status:409});}
}
