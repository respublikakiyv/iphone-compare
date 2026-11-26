import {db} from './auth';
import {cleanOptionalStores,optionalStores} from './stores.ts';
async function table(){await db().prepare('CREATE TABLE IF NOT EXISTS personal_stores(user_id TEXT PRIMARY KEY,payload TEXT NOT NULL,updated TEXT NOT NULL)').run();}
// A fresh Telegram account should see every supported retailer. Users can still
// turn individual sources off in the "Магазины" tab afterwards.
export async function readPersonalStores(user:string){await table();const row=await db().prepare('SELECT payload FROM personal_stores WHERE user_id=?').bind(user).first<any>();return row?cleanOptionalStores(JSON.parse(row.payload)):[...optionalStores];}
export async function writePersonalStores(user:string,value:unknown){const stores=cleanOptionalStores(value);await table();await db().prepare('INSERT INTO personal_stores(user_id,payload,updated) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET payload=excluded.payload,updated=excluded.updated').bind(user,JSON.stringify(stores),new Date().toISOString()).run();return stores;}
