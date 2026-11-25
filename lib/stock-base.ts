import {db} from './auth';
import {stockProductKey,quantityFor,matchingStockRows,type CardStock} from './warehouse-stock.ts';
import type {Product} from './catalog.ts';
export type StockBase={values:Record<string,CardStock>;targets:Record<string,string[]>;checkedAt:(string|null)[];verifiedAt?:Record<string,(string|null)[]>;updatedAt?:string;syncedAt?:string};
const empty=():StockBase=>({values:{},targets:{},checkedAt:[null,null,null]});
export async function readStockBase(used=true):Promise<StockBase>{
 const legacy=used?await db().prepare('SELECT payload FROM snapshots WHERE id=?').bind('used-stock-base-v1').first<{payload:string}>():null;
 const base:StockBase=legacy?JSON.parse(legacy.payload):empty();base.verifiedAt||={};for(const [key,values]of Object.entries(base.values))base.verifiedAt[key]||=values.map((value,i)=>typeof value==='number'?base.checkedAt?.[i]||null:null);const prefix='stock-card:'+(used?'used:':'new:');
 const rows=await db().prepare('SELECT id,payload,updated FROM snapshots WHERE id LIKE ?').bind(prefix+'%').all<{id:string;payload:string;updated:string}>();
 for(const row of rows.results){const card=JSON.parse(row.payload),key=row.id.slice(prefix.length);base.values[key]=card.values;base.targets[key]=card.targets;base.verifiedAt![key]=card.verifiedAt||[null,null,null];if(!base.updatedAt||row.updated>base.updatedAt)base.updatedAt=row.updated;}
 const checkpoints=await db().prepare('SELECT payload,updated FROM snapshots WHERE id IN (?,?)').bind('stock-cursor:all','stock-cursor:'+(used?'used':'new')).all<{payload:string;updated:string}>();
 for(const row of checkpoints.results){const cursor=JSON.parse(row.payload);if(!base.updatedAt||row.updated>base.updatedAt)base.updatedAt=row.updated;const verified=cursor.at;if(typeof verified==='string'&&Number.isFinite(Date.parse(verified))&&(!base.syncedAt||verified>base.syncedAt))base.syncedAt=verified;if(typeof verified==='string'&&Number.isFinite(Date.parse(verified)))for(const key of Object.keys(base.verifiedAt!))base.verifiedAt![key]=base.verifiedAt![key].map(date=>date&&Date.parse(verified)>Date.parse(date)?verified:date);}
 return base;
}
export async function saveStockBase(base:StockBase,used=true){const now=new Date().toISOString();await db().prepare('INSERT INTO snapshots(id,payload,updated) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated=excluded.updated').bind(used?'used-stock-base-v1':'new-stock-base-v1',JSON.stringify({...base,updatedAt:now}),now).run();}
export async function updateStockCards(products:Product[],reports:({rows:any[];checkedAt:string}|null)[],used:boolean){
 const before=used?await readStockBase():empty(),values:Record<string,CardStock>={},targets:Record<string,string[]>={};
 for(const p of products){const key=stockProductKey(p);values[key]=reports.map((r,i)=>r?quantityFor(p,r.rows):before.values[key]?.[i]??null);targets[key]=[...new Set(reports.flatMap(r=>r?matchingStockRows(p,r.rows).map(row=>row.id):before.targets[key]||[]))];}
 const checkedAt=reports.map((r,i)=>r?.checkedAt||before.checkedAt[i]);
 if(used&&reports.some(Boolean)){
  if(!Object.keys(before.values).length)await saveStockBase(before);
  // Patch only these cards atomically; concurrent refreshes cannot replace other cards.
  for(const p of products){const key=stockProductKey(p),now=new Date().toISOString();await db().prepare('UPDATE snapshots SET payload=json_set(payload,?,json(?),?,json(?),?,?),updated=? WHERE id=?').bind('$.values.'+JSON.stringify(key),JSON.stringify(values[key]),'$.targets.'+JSON.stringify(key),JSON.stringify(targets[key]),'$.updatedAt',now,now,'used-stock-base-v1').run();}
 }
 return {values,targets,checkedAt,partial:reports.some(r=>!r),updatedAt:reports.some(Boolean)?new Date().toISOString():before.updatedAt};
}

export async function writeStockSnapshots(entries:{id:string;value:unknown}[],now:string){
 for(let start=0;start<entries.length;start+=80){const rows=entries.slice(start,start+80).map(r=>({id:r.id,payload:JSON.stringify(r.value)}));
  await db().prepare("INSERT INTO snapshots(id,payload,updated) SELECT json_extract(value,'$.id'),json_extract(value,'$.payload'),? FROM json_each(?) WHERE true ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated=excluded.updated WHERE excluded.updated>=snapshots.updated").bind(now,JSON.stringify(rows)).run();
 }
}
export async function patchStockBase(values:Record<string,CardStock>,targets:Record<string,string[]>,used:boolean,now:string,verifiedAt?:Record<string,(string|null)[]>){
 const prefix='stock-card:'+(used?'used:':'new:');
 // A single SQL statement per chunk also stays below the hosted D1 query limit.
 // Small independent rows prevent late responses from replacing newer cards.
 await writeStockSnapshots(Object.entries(values).map(([key,v])=>({id:prefix+key,value:{values:v,targets:targets[key]||[],...(verifiedAt?.[key]?{verifiedAt:verifiedAt[key]}:{})}})),now);
 if(Object.keys(values).length)await writeStockSnapshots([{id:'stock-version:'+(used?'used':'new'),value:{}}],now);
}

export async function stockVersion(used:boolean){
 const rows=await db().prepare('SELECT id,updated FROM snapshots WHERE id IN (?,?) ORDER BY id').bind('stock-version:all','stock-version:'+(used?'used':'new')).all<{id:string;updated:string}>();
 return rows.results.map(row=>row.id+'='+row.updated).join('|')||'initial';
}
