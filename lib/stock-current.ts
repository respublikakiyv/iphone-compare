import {stockWarehouses,type CardStock} from './warehouse-stock.ts';
export const assortmentId=(href:string)=>/^https:\/\/api\.moysklad\.ru\/api\/remap\/1\.2\/entity\/(?:product|variant)\/([a-f0-9-]{36})$/.exec(href)?.[1]||null;
export type CurrentRow={assortmentId:string;storeId:string;stock:number|null};
export type CurrentStock={values:CardStock;checkedAt:string;warehouseCheckedAt?:(string|null)[]};
export function currentStockUrl(ids:string[],since?:string){
 if(!ids.length||ids.length>80||ids.some(id=>!/^[-a-f0-9]{36}$/.test(id)))throw Error('Invalid stock IDs');
 const q=new URLSearchParams({filter:'assortmentId='+[...new Set(ids)].join(',')+';storeId='+stockWarehouses.map(w=>w.id).join(','),stockType:'stock',include:'zeroLines',withRecalculate:'true'});
 if(since){q.set('changedSince',since);q.delete('include');}
 return 'https://api.moysklad.ru/api/remap/1.2/report/stock/bystore/current?'+q;
}
// The API uses Moscow local time; a two-minute overlap covers delayed recalculation.
export function changedSince(checkpoint:string,now=Date.now()){
 const time=Date.parse(checkpoint)-120000;if(!Number.isFinite(time)||now-time>23*3600000||time>now)return undefined;
 return new Date(time+3*3600000).toISOString().slice(0,19).replace('T',' ');
}
export function applyCurrent(ids:string[],rows:unknown,previous:Record<string,CurrentStock>,checkedAt:string,delta=false){
 if(!Array.isArray(rows))throw Error('Invalid current stock report');
 const wanted=new Set(ids),seen=new Set<string>(),pending=new Set<string>(),values:Record<string,CurrentStock>={};
 for(const id of ids)values[id]={values:delta?[...(previous[id]?.values||[null,null,null])]:[0,0,0],checkedAt,warehouseCheckedAt:delta?[...(previous[id]?.warehouseCheckedAt||[null,null,null])]:stockWarehouses.map(()=>checkedAt)};
 for(const row of rows as CurrentRow[]){const i=stockWarehouses.findIndex(w=>w.id===row.storeId);if(!wanted.has(row.assortmentId)||i<0)throw Error('Unexpected stock row');const key=row.assortmentId+'|'+i;if(seen.has(key))throw Error('Duplicate stock row');seen.add(key);
  if(row.stock===null){pending.add(row.assortmentId);values[row.assortmentId].values[i]=previous[row.assortmentId]?.values[i]??null;values[row.assortmentId].warehouseCheckedAt![i]=previous[row.assortmentId]?.warehouseCheckedAt?.[i]||null;}
  else if(!Number.isInteger(row.stock))throw Error('Invalid stock quantity');
  else{values[row.assortmentId].values[i]=row.stock;values[row.assortmentId].warehouseCheckedAt![i]=checkedAt;}
 }
 return {values,pending:[...pending]};
}
export function aggregateCurrent(targets:string[],raw:Record<string,CurrentStock>):CardStock{
 const ids=[...new Set(targets.map(assortmentId).filter((id):id is string=>!!id))];
 return stockWarehouses.map((_,i)=>{const n=ids.map(id=>raw[id]?.values[i]);return n.length&&n.every(v=>typeof v==='number')?n.reduce<number>((s,v)=>s+v!,0):null;});
}

export function currentChangesUrl(since:string){
 const q=new URLSearchParams({filter:'storeId='+stockWarehouses.map(w=>w.id).join(','),stockType:'stock',withRecalculate:'true',changedSince:since});
 return 'https://api.moysklad.ru/api/remap/1.2/report/stock/bystore/current?'+q;
}

export function aggregateVerifiedAt(targets:string[],raw:Record<string,CurrentStock>){
 const ids=[...new Set(targets.map(assortmentId).filter((id):id is string=>!!id))];
 return stockWarehouses.map((_,i)=>{const dates=ids.map(id=>typeof raw[id]?.values[i]==='number'?raw[id]?.warehouseCheckedAt?.[i]:null);return dates.length&&dates.every((date):date is string=>!!date&&Number.isFinite(Date.parse(date)))?dates.sort((a,b)=>Date.parse(a)-Date.parse(b))[0]:null;});
}
