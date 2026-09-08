import { Pool } from 'pg';
const globalDb = globalThis as unknown as { stockadePool?: Pool };
export const db = globalDb.stockadePool ?? new Pool({ connectionString: process.env.DATABASE_URL ?? 'postgresql://stockade:stockade_local_only@127.0.0.1:54329/stockade', max: 8, idleTimeoutMillis: 30000 });
if (process.env.NODE_ENV !== 'production') globalDb.stockadePool = db;
export const fulfil = () => process.env.FULFIL_URL ?? 'http://127.0.0.1:5080';
export {validOrigin} from './origin';
