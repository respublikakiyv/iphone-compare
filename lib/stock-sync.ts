import {requireStockIntegration,stockIntegrationPaused,stockManualOnly,isManualStockUpdate} from './stock-integration';
import {env} from 'cloudflare:workers';
import {db} from './auth';
import {cloudCatalog} from './cloud-refresh';
import {belongs} from './inventory';
import type {Product} from './catalog';
import {stockRequest,warehouseReport,cachedWarehouseReport} from './moysklad';
import {readStockBase,patchStockBase,writeStockSnapshots} from './stock-base';
import {stockSearch,stockProductKey,matchingStockRows,stockWarehouses,type CardStock} from './warehouse-stock';
import {assortmentId,currentStockUrl,currentChangesUrl,changedSince,applyCurrent,aggregateCurrent,aggregateVerifiedAt,type CurrentStock} from './stock-current';
import {readStockMetadata} from './stock-metadata';
import {usedStockSearch} from './moysklad-report';
export async function stockSnapshot<T>(id:string):Promise<T|null>{const row=await db().prepare('SELECT payload FROM snapshots WHERE id=?').bind(id).first<{payload:string}>();return row?JSON.parse(row.payload):null;}
export async function putStockSnapshot(id:string,value:unknown,at=new Date().toISOString()){await db().prepare('INSERT INTO snapshots(id,payload,updated) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated=excluded.updated WHERE excluded.updated>=snapshots.updated').bind(id,JSON.stringify(value),at).run();if(id.startsWith('stock-cursor:'))await writeStockSnapshots([{id:id.replace('stock-cursor:','stock-version:'),value:{}}],at);}
async function rawStock(ids:string[]){const result:Record<string,CurrentStock>={};for(let n=0;n<ids.length;n+=80){const keys=ids.slice(n,n+80).map(id=>'stock-current:'+id);if(!keys.length)continue;const rows=await db().prepare('SELECT id,payload FROM snapshots WHERE id IN ('+keys.map(()=>'?').join(',')+')').bind(...keys).all<{id:string;payload:string}>();for(const row of rows.results)result[row.id.slice(14)]=JSON.parse(row.payload);}return result;}
// Mapping discovery is independent from quantity checks. Reuse full metadata, not names from a short report.
export async function mapStockProducts(products:Product[],used:boolean,reports?:Awaited<ReturnType<typeof warehouseReport>>[]){
 const old=await readStockBase(used),targets={...old.targets};for(const p of products)if(p.stock_id)targets[stockProductKey(p)]=[p.stock_id];
 if(!reports&&products.every(p=>Object.hasOwn(targets,stockProductKey(p))))return {old,targets};
 const groups=new Map<string,Product[]>();for(const p of products){const search=used?usedStockSearch:stockSearch(p);if(search){const group=groups.get(search)||[];group.push(p);groups.set(search,group);}}
 const metadata=await stockSnapshot<{rows:any[];checkedAt:string}>('stock-assortment-map');
 const global=reports||(metadata?[metadata]:await Promise.all(stockWarehouses.map((_,i)=>cachedWarehouseReport('',i))));
 const sharedRows=reports||metadata?[...new Map(global.flatMap(r=>r?.rows||[]).map(r=>[r.id,r])).values()]:null;
 for(const [search,group] of groups){const specific=sharedRows?[]:await Promise.all(stockWarehouses.map((_,i)=>cachedWarehouseReport(search,i)));const rows=sharedRows||[...new Map([...global,...specific].flatMap(r=>r?.rows||[]).map(r=>[r.id,r])).values()];
  for(const p of group){if(!reports&&targets[stockProductKey(p)]?.length)continue;const matches=matchingStockRows(p,rows).map(r=>r.id).filter(id=>assortmentId(id));if(matches.length)targets[stockProductKey(p)]=[...new Set(matches)];}
 }
 return {old,targets};
}
export async function refreshStockCards(products:Product[],used:boolean,options:{since?:string;deltaRows?:any[];targets?:Record<string,string[]>}={}){
 requireStockIntegration();
 const token=(env as any).MOYSKLAD_TOKEN;if(!token)throw Error('Stock provider unavailable');
 const mapped=options.targets?{old:await readStockBase(used),targets:options.targets}:await mapStockProducts(products,used),targets=mapped.targets;
 const ids=[...new Set(products.flatMap(p=>(targets[stockProductKey(p)]||[]).map(assortmentId).filter((id):id is string=>!!id)))];
 const started=new Date().toISOString();let partial=false,requests=0,changed=0;
 const previous=await rawStock(ids),raw={...previous};
 // Three bounded workers share the same provider request slots with metadata discovery.
 let next=0;const chunks=Array.from({length:Math.ceil(ids.length/80)},(_,i)=>ids.slice(i*80,(i+1)*80));
 await Promise.all(Array.from({length:Math.min(3,chunks.length)},async()=>{while(next<chunks.length){const chunk=chunks[next++];try{
  const delta=!!options.since&&chunk.every(id=>previous[id]);let rows:unknown;if(delta&&options.deltaRows){const selected=new Set(chunk);rows=options.deltaRows.filter(row=>selected.has(row.assortmentId));}else{requests++;rows=await stockRequest(currentStockUrl(chunk,delta?options.since:undefined),token);}let applied=applyCurrent(chunk,rows,previous,started,delta);changed+=(rows as any[]).length;
  if(applied.pending.length){await new Promise(r=>setTimeout(r,600));requests++;const retry=applyCurrent(applied.pending,await stockRequest(currentStockUrl(applied.pending),token),applied.values,started);Object.assign(applied.values,retry.values);applied.pending=retry.pending;}
  if(applied.pending.length)partial=true;
  Object.assign(raw,applied.values);const affected=new Set((rows as any[]).map(row=>row.assortmentId));await writeStockSnapshots(Object.entries(applied.values).filter(([id])=>!delta||affected.has(id)).map(([id,v])=>({id:'stock-current:'+id,value:v})),started);
 }catch(e){partial=true;console.error('Short stock report failed',e instanceof Error?e.message:'unknown');}}}));
 // Re-read current per-ID snapshots so overlapping requests never restore older counts.
 Object.assign(raw,await rawStock(ids));const verifiedAt:Record<string,(string|null)[]>={},values:Record<string,CardStock>={},selectedTargets:Record<string,string[]>={};
 for(const p of products){const key=stockProductKey(p);selectedTargets[key]=targets[key]||[];const v=aggregateCurrent(selectedTargets[key],raw);values[key]=v.map((n,i)=>n??mapped.old.values[key]?.[i]??null);const dates=aggregateVerifiedAt(selectedTargets[key],raw);verifiedAt[key]=dates.map((date,i)=>date||mapped.old.verifiedAt?.[key]?.[i]||null);}
 if(ids.length){const changedValues=options.since?Object.fromEntries(Object.entries(values).filter(([key,v])=>JSON.stringify(v)!==JSON.stringify(mapped.old.values[key])||JSON.stringify(selectedTargets[key])!==JSON.stringify(mapped.old.targets[key])||JSON.stringify(verifiedAt[key])!==JSON.stringify(mapped.old.verifiedAt?.[key]))):values;await patchStockBase(changedValues,selectedTargets,used,started,verifiedAt);}
 return {values,verifiedAt,updatedAt:ids.length?started:mapped.old.updatedAt,checkedAt:stockWarehouses.map(()=>started),partial,unmapped:products.filter(p=>!selectedTargets[stockProductKey(p)]?.length).length,requests,changed};
}
export async function syncStock(scope:'used'|'new'|'all'='all',discover=false,minIntervalMs=0){
 if(stockIntegrationPaused()||stockManualOnly()&&!isManualStockUpdate())return {paused:true,requests:0,partial:false};
 const d=db(),now=Date.now(),claim=crypto.randomUUID(),id='stock-global-sync';
 await d.prepare('INSERT OR IGNORE INTO cloud_refresh(id,payload,lease,token,updated) VALUES(?,?,0,?,?)').bind(id,'{}','',new Date().toISOString()).run();
 const lock=await d.prepare('UPDATE cloud_refresh SET lease=?,token=? WHERE id=? AND lease<=?').bind(now+180000,claim,id,now).run();if(!lock.meta.changes)return {busy:true};
 try{
  const cursor=await stockSnapshot<{at:string;fullAt:string;catalogAt?:string;unmapped?:number}>('stock-cursor:'+scope);
  if(minIntervalMs&&cursor&&now-Date.parse(cursor.at)<minIntervalMs)return {throttled:true,requests:0,partial:false,updatedAt:cursor.at};
  if(minIntervalMs){const attempt=await stockSnapshot<{at:number}>('stock-reconcile-attempt:'+scope);if(attempt&&now-attempt.at<minIntervalMs)return {throttled:true,requests:0};await putStockSnapshot('stock-reconcile-attempt:'+scope,{at:now});}
  const catalog=await cloudCatalog(),summary:any={partial:false,requests:0,changed:0,unmapped:0};
  const since=!isManualStockUpdate()&&cursor&&Date.now()-Date.parse(cursor.fullAt)<20*3600000?changedSince(cursor.at):undefined;
  let reports:Awaited<ReturnType<typeof warehouseReport>>[]|undefined;
  if(discover){try{const metadata=await readStockMetadata(url=>stockRequest(url,(env as any).MOYSKLAD_TOKEN));await putStockSnapshot('stock-assortment-map',metadata);reports=[metadata];}catch(e){summary.partial=true;console.error('Stock metadata discovery failed',e instanceof Error?e.message:'unknown');}}
  let deltaRows:any[]|undefined;
  if(since){summary.requests++;const rows=await stockRequest(currentChangesUrl(since),(env as any).MOYSKLAD_TOKEN);
   if(!Array.isArray(rows)||rows.some(row=>typeof row.assortmentId!=='string'||!stockWarehouses.some(w=>w.id===row.storeId)||row.stock!==null&&!Number.isInteger(row.stock)))throw Error('Invalid stock changes');
   deltaRows=rows;
   const catalogUnchanged=cursor?.catalogAt===catalog.updated_at||!cursor?.catalogAt&&Date.parse(catalog.updated_at||'')<=Date.parse(cursor?.at||'');
   if(!rows.length&&!discover&&catalogUnchanged){
    await putStockSnapshot('stock-cursor:'+scope,{...cursor,at:new Date(now).toISOString(),catalogAt:catalog.updated_at});
    return {...summary,unmapped:cursor?.unmapped||0,mode:'changes',discovered:false,updatedAt:new Date(now).toISOString()};
   }
  }
  for(const used of scope==='all'?[true,false]:[scope==='used']){
   const products=catalog.products.filter(p=>belongs(p,used?'used':'new')),mapped=await mapStockProducts(products,used,reports);
   const r=await refreshStockCards(products,used,{since,deltaRows,targets:mapped.targets});summary.partial||=r.partial;summary.requests+=r.requests;summary.changed+=r.changed;summary.unmapped+=r.unmapped;
  }
  if(!summary.partial)await putStockSnapshot('stock-cursor:'+scope,{at:new Date(now).toISOString(),fullAt:since?cursor!.fullAt:new Date(now).toISOString(),catalogAt:catalog.updated_at,unmapped:summary.unmapped});
  return {...summary,mode:since?'changes':'full',discovered:discover,updatedAt:new Date(now).toISOString()};
 }finally{await d.prepare('UPDATE cloud_refresh SET lease=0,token=? WHERE id=? AND token=?').bind('',id,claim).run();}
}

// A short, shared cache and a per-assortment lease coalesce sellers opening the same view.
export async function refreshStockView(products:Product[],used:boolean){
 requireStockIntegration();const mapped=await mapStockProducts(products,used),ids=[...new Set(products.flatMap(p=>(mapped.targets[stockProductKey(p)]||[]).map(assortmentId).filter((id):id is string=>!!id)))].sort();
 const cached=async()=>{const raw=await rawStock(ids);if(!ids.length||!ids.every(id=>raw[id]?.warehouseCheckedAt?.length===3&&raw[id].warehouseCheckedAt!.every(date=>date&&Date.now()-Date.parse(date)>=0&&Date.now()-Date.parse(date)<30000)))return null;
 const values:Record<string,CardStock>={},verifiedAt:Record<string,(string|null)[]>={};for(const p of products){const key=stockProductKey(p);values[key]=aggregateCurrent(mapped.targets[key]||[],raw);verifiedAt[key]=aggregateVerifiedAt(mapped.targets[key]||[],raw);}
 return {values,verifiedAt,updatedAt:new Date(Math.min(...ids.flatMap(id=>raw[id].warehouseCheckedAt!.map(date=>Date.parse(date!))))).toISOString(),partial:false,cached:true,requests:0,unmapped:products.filter(p=>!mapped.targets[stockProductKey(p)]?.length).length};};
 const fresh=await cached();if(fresh)return fresh;
 if(!ids.length)return refreshStockCards(products,used,{targets:mapped.targets});
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ids.join('|'))),key='stock-view:'+Array.from(new Uint8Array(digest)).map(v=>v.toString(16).padStart(2,'0')).join(''),claim=crypto.randomUUID(),deadline=Date.now()+30000,d=db();
 await d.prepare('INSERT OR IGNORE INTO cloud_refresh(id,payload,lease,token,updated) VALUES(?,?,0,?,?)').bind(key,'{}','',new Date().toISOString()).run();
 for(;;){const now=Date.now(),lock=await d.prepare('UPDATE cloud_refresh SET lease=?,token=? WHERE id=? AND lease<=?').bind(now+90000,claim,key,now).run();
 if(lock.meta.changes)break;const latest=await cached();if(latest)return latest;if(now>deadline)return {busy:true,requests:0};await new Promise(r=>setTimeout(r,250));}
 try{const latest=await cached();return latest||await refreshStockCards(products,used,{targets:mapped.targets});}
 finally{await d.prepare('UPDATE cloud_refresh SET lease=0,token=? WHERE id=? AND token=?').bind('',key,claim).run();}
}
