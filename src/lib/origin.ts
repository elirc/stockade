/** Validate the configured public origin, not Next's internal request URL. */
export function validOrigin(request:Request):boolean {
 const origin=request.headers.get('origin');
 const allowed=(process.env.ALLOWED_ORIGINS??'http://127.0.0.1:3000,http://localhost:3000').split(',').map(x=>x.trim());
 return origin!==null&&allowed.includes(origin);
}
