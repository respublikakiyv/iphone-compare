import {observationKeyMatches} from './apple-products.ts';
import {catalogRoots,cleanOptionalStores,optionalStores,primaryStores} from './stores.ts';
import {mergeCatalog,canonicalColor,hasPrice,type Product} from './catalog.ts';
import {belongs,keepProduct,edition,type Inventory} from './inventory.ts';
import {futureTimestamp,timestampMillis} from './time.ts';
export type Catalog={products:Product[];stores:Record<string,any>;updated_at?:string;seed_revision?:string};
export type DeviceState={catalogVersion?:string;cachedAt?:string;catalog:Catalog;rate:string|null;job:any;rateSource?:string;rateCheckedAt?:string;rateError?:string;extraStores?:string[]};
const key=(user:string)=>'iphone-catalog:v2:'+user;
const volatileDevices=new Map<string,DeviceState>();
export function readDevice(user:string):DeviceState|null{if(volatileDevices.has(user))return volatileDevices.get(user)!;try{
 const d=JSON.parse(localStorage.getItem(key(user))||'null');
 if(d?.encoding==='device-columns-v1'&&Array.isArray(d.fields)&&Array.isArray(d.catalog?.products))d.catalog.products=d.catalog.products.map((row:any[])=>Object.fromEntries(row[0].map((index:number,i:number)=>[d.fields[index],row[i+1]])));
 if(d){delete d.encoding;delete d.fields;}
 return d&&Array.isArray(d.catalog?.products)&&d.catalog.stores?d:volatileDevices.get(user)||null;
 }catch{return volatileDevices.get(user)||null;}}

export function migrateDevice(state:DeviceState):DeviceState{return {...state,extraStores:cleanOptionalStores((Array.isArray(state.extraStores)?state.extraStores:[]).filter(s=>optionalStores.includes(s))),catalog:{...state.catalog,products:state.catalog.products.filter(keepProduct).map(p=>({...p,edition:edition(p)}))}};}
export function saveDevice(user:string,state:DeviceState){
 // A shared catalog can exceed WebView's localStorage quota in its object form.
 // Column names are stored once; the server remains the authoritative full backup.
 try{
  const fields=[...new Set(state.catalog.products.flatMap(p=>Object.keys(p)))],index=new Map(fields.map((field,i)=>[field,i]));
  const products=state.catalog.products.map(p=>{const entries=Object.entries(p).filter(([,value])=>value!==undefined);return [entries.map(([field])=>index.get(field)),...entries.map(([,value])=>value)];});
  localStorage.setItem(key(user),JSON.stringify({...state,encoding:'device-columns-v1',fields,catalog:{...state.catalog,products}}));volatileDevices.delete(user);return 'full';
 }catch{
  volatileDevices.set(user,state);
  // Keep personal store choices even when the full cache cannot fit or is disabled.
  try{localStorage.setItem(key(user),JSON.stringify({catalog:{products:[],stores:{}},rate:state.rate,job:null,extraStores:state.extraStores||[]}));return 'preferences';}catch{return 'memory';}
 }
}


export function sameVariant(a:Product,b:Product){return observationKeyMatches(a,b)&&['store','model','storage','sim','edition'].every(k=>(a as any)[k]===(b as any)[k])&&canonicalColor(a.model,a.color)===canonicalColor(b.model,b.color);}
export function needsTimeRepair(catalog:Catalog,now=Date.now()){return futureTimestamp(catalog.updated_at,now)||catalog.products.some(p=>futureTimestamp(p.last_success_at||p.checked_at,now));}
export function repairDeviceTimes(state:DeviceState,verified:Catalog,now=Date.now()):DeviceState{
 const byUrl=new Map(verified.products.map(p=>[p.store+'|'+p.url,p]));let repaired=false;
 const products=state.catalog.products.map(p=>{
  if(!futureTimestamp(p.last_success_at||p.checked_at,now))return p;
  const fresh=byUrl.get(p.store+'|'+p.url);
  if(!fresh||!sameVariant(p,fresh)||!hasPrice(fresh)||!['ok','preorder','unavailable'].includes(fresh.status))return p;
  const stamp=fresh.last_success_at||fresh.checked_at;
  if(!Number.isFinite(timestampMillis(stamp))||futureTimestamp(stamp,now)||!Number.isFinite(timestampMillis(fresh.checked_at))||futureTimestamp(fresh.checked_at,now))return p;
  repaired=true;return {...fresh};
 });
 const trustedSummary=Number.isFinite(timestampMillis(verified.updated_at))&&!futureTimestamp(verified.updated_at,now);
 return {...state,catalog:{...state.catalog,products,updated_at:trustedSummary&&(repaired||futureTimestamp(state.catalog.updated_at,now))?verified.updated_at:state.catalog.updated_at}};
}
export const SEED_REVISION='2026-10-15-ispace-sim-repair';
export function needsSeedRepair(catalog:Catalog,now=Date.now()){return catalog.seed_revision!==SEED_REVISION||needsTimeRepair(catalog,now);}
export function repairDeviceSeed(state:DeviceState,verified:Catalog,now=Date.now()):DeviceState{
 const next=repairDeviceTimes(state,verified,now),known=new Set(next.catalog.products.map(p=>p.store+'|'+p.url));
 const additions=verified.products.filter(p=>{
  const model=p.model;const wanted=p.store==='iSpace'||(edition(p)==='Standard'&&['17e','17 Air'].includes(model))||(edition(p)==='Used'&&p.store==='iPeople'&&(p.sim==='physical'||p.model==='17 Air'&&p.sim==='esim')&&/^17(?:\s|$)/.test(model));
  const stamp=p.last_success_at||p.checked_at;
  return wanted&&!known.has(p.store+'|'+p.url)&&hasPrice(p)&&['ok','preorder','unavailable'].includes(p.status)&&Number.isFinite(timestampMillis(stamp))&&!futureTimestamp(stamp,now);
 });
 return {...next,catalog:{...next.catalog,stores:{...verified.stores,...next.catalog.stores},products:[...next.catalog.products.map(p=>{const v=verified.products.find(v=>v.store===p.store&&v.url===p.url);return v&&verifiedSimCorrection(p,v)?{...v,metadata_notice:'Тип SIM исправлен по карточке магазина: '+p.sim+' → '+v.sim}:p;}),...additions],seed_revision:verified.seed_revision===SEED_REVISION?SEED_REVISION:next.catalog.seed_revision,updated_at:additions.length&&Number.isFinite(timestampMillis(verified.updated_at))&&!futureTimestamp(verified.updated_at,now)?verified.updated_at:next.catalog.updated_at}};
}
export function verifiedSimCorrection(a:Product,b:Product){return a.store==='iPeople'&&!hasPrice(a)&&a.store===b.store&&a.url===b.url&&!!a.sku&&a.sku===b.sku&&a.sim!==b.sim&&['model','storage','edition'].every(k=>(a as any)[k]===(b as any)[k])&&canonicalColor(a.model,a.color)===canonicalColor(b.model,b.color)&&hasPrice(b)&&['ok','preorder','unavailable'].includes(b.status);}
export function priceObservation(old:Product,record:Product|null){const stamp=new Date().toISOString();if(record&&verifiedSimCorrection(old,record))return {...record,metadata_notice:'Тип SIM исправлен по карточке магазина: '+old.sim+' → '+record.sim};if(!record||!sameVariant(old,record))return {...old,status:'error',checked_at:stamp,last_success_at:old.last_success_at||(old.price?old.checked_at:null)};return mergeCatalog({products:[old]},{products:[record]}).products[0];}
export async function refreshDevice(kind:string,initial:Catalog,read:(store:string,url:string)=>Promise<any>,progress:(catalog:Catalog,job:any)=>void,signal:AbortSignal,scope:Inventory='new',enabledStores=primaryStores){
 const catalog:Catalog=JSON.parse(JSON.stringify(initial));const started=new Date().toISOString();let errors=0;const job:any={kind,status:'running',scope,progress:0,message:'Начинаем обновление',created:started};const check=()=>{if(signal.aborted)throw new Error('Обновление остановлено. Сохранены уже проверенные цены.');};
 const selectedStores=[...new Set(scope==='used'?['iPeople']:enabledStores)];
 const blocked=(reason:string)=>['http_403','http_429','robots_denied','source_challenge','crawl_delay_too_long'].includes(reason);
 const completed=selectedStores.map(()=>0);
 const notify=(message:string,percent:number,storeIndex:number)=>{check();completed[storeIndex]=Math.max(completed[storeIndex],Math.min(100,percent));job.message=message;job.progress=Math.min(99,Math.floor(completed.reduce((sum,value)=>sum+value,0)/Math.max(1,selectedStores.length)));progress({...catalog,stores:{...catalog.stores},products:[...catalog.products]}, {...job});};
 // Stores have independent crawl reservations. Keep one request per store in flight.
 const results=await Promise.allSettled(selectedStores.map(async(store,storeIndex)=>{check();let failed=false,count=0,storeErrors=0,storeError:string|null=null;
  const old=catalog.products.filter(p=>p.store===store&&belongs(p,scope));const oldByUrl=new Map(old.map(p=>[p.url,p]));let pending:string[]=kind==='prices'?[...oldByUrl.keys()]:[];const done=new Set<string>();const collected:Product[]=[];
  try{
   if(kind==='catalog'||!old.length){
    const pages=[scope==='used'?'https://ipeople.ua/b-u-tekhnyka-ua/b-u-iphone-ua':catalogRoots[store]];
    const seen=new Set<string>();const pageKey=(v:string)=>{const u=new URL(v);return u.origin+u.pathname.replace(/\/+$/,'')+u.search;};
    while(pages.length){check();const page=pages.shift()!,key=pageKey(page);if(seen.has(key))continue;if(seen.size>=100)throw new Error('pagination_limit');seen.add(key);
     let result:any;try{result=await read(store,page);if(!result.catalogPage)throw new Error('layout_changed');}catch(e:any){check();if(blocked(e.message))throw e;failed=true;errors++;storeErrors++;storeError=e.message;continue;}pending.push(...result.urls);
     const categories=(result.categories||[]).filter((v:string)=>!seen.has(pageKey(v)));pages.unshift(...categories);if(result.next&&!seen.has(pageKey(result.next)))pages.push(result.next);
     notify(`${store}: найдено ${new Set(pending).size} карточек`,2,storeIndex);
    }
    if(failed)pending.push(...oldByUrl.keys());
    pending.sort((a,b)=>Number(/iphone-(\d+)/.exec(b)?.[1]||0)-Number(/iphone-(\d+)/.exec(a)?.[1]||0));
   }
   // Category pages can repeat product links; avoid redundant queue entries.
   pending=[...new Set(pending)];const queued=new Set(pending);
   while(pending.length){check();const url=pending.shift()!;if(done.has(url))continue;if(done.size>=2000)throw new Error('request_budget');done.add(url);const before=oldByUrl.get(url);try{const result=await read(store,url);check();if(result.gone)throw Error('http_404');const record=result.record&&belongs(result.record,scope)?result.record:null;
    if(kind==='prices'&&before){const observed=priceObservation(before,record);catalog.products=catalog.products.map(p=>p.store===store&&p.url===url?observed:p);if(observed.status==='error'){errors++;storeErrors++;failed=true;}else count++;}
    else if(record){collected.push(record);if(record.status==='error'){errors++;storeErrors++;failed=true;}else count++;const existing=catalog.products.find(p=>p.store===store&&p.url===url);const observed=existing&&sameVariant(existing,record)?priceObservation(existing,record):record;catalog.products=[...catalog.products.filter(p=>p.store!==store||p.url!==url),observed];}
    else if(!result.ignored)throw new Error('unverified_product');
    if(kind==='catalog'||!old.length)for(const v of result.variants||[])if(!queued.has(v)){queued.add(v);pending.push(v);}
   }catch(e:any){check();const removed=e.message==='http_404';if(removed){count++;if(before)collected.push({...before,status:'unavailable',checked_at:new Date().toISOString(),last_success_at:before.last_success_at||before.checked_at});}else{errors++;storeErrors++;failed=true;storeError=e.message;}if(before)catalog.products=catalog.products.map(p=>p.store===store&&p.url===url?{...p,status:e.message==='http_404'?'unavailable':'error',checked_at:new Date().toISOString(),last_success_at:p.last_success_at||(p.price?p.checked_at:null)}:p);if(blocked(e.message))throw e;}
    catalog.updated_at=new Date().toISOString();notify(`${store}: проверено ${done.size}, осталось ${new Set(pending).size}`,10+90*done.size/(done.size+pending.length),storeIndex);
   }
   if(kind==='catalog'||!old.length){if(!collected.length)throw new Error('no_verified_variants');if(!failed){const merged=mergeCatalog({products:old},{products:collected});catalog.products=[...catalog.products.filter(p=>p.store!==store||!belongs(p,scope)),...merged.products];}}
  }catch(e:any){check();storeError=e.message;failed=true;errors++;if(!storeErrors)storeErrors++;catalog.products=catalog.products.map(p=>p.store===store&&belongs(p,scope)&&!done.has(p.url)?{...p,status:'error',last_success_at:p.last_success_at||(p.price?p.checked_at:null)}:p);notify(`${store}: ${e.message}. Последние цены сохранены.`,100,storeIndex);}
  const stateKey=scope==='used'?store+':used':store;catalog.stores[stateKey]={error:storeError,status:failed?(count?'partial':'error'):'ok',message:`${count} карточек проверено${storeErrors?`, не удалось проверить: ${storeErrors}`:''}`,updated_at:new Date().toISOString(),prices_updated_at:!failed&&count?new Date().toISOString():initial.stores[stateKey]?.prices_updated_at,full_updated_at:kind==='catalog'&&!failed?new Date().toISOString():initial.stores[stateKey]?.full_updated_at};
  notify(`${store}: ${catalog.stores[stateKey].message}`,100,storeIndex);
 }));
 // Await every store before returning or rejecting, so no late writes follow cancellation.
 const rejected=results.find((result):result is PromiseRejectedResult=>result.status==='rejected');
 if(rejected)throw rejected.reason;
 check();
 job.status=errors?'partial':'succeeded';job.progress=100;job.message=errors?'Обновление завершено с ошибками. Последние подтверждённые цены сохранены.':'База на этом устройстве обновлена.';catalog.updated_at=new Date().toISOString();progress(catalog,job);return {catalog,job};
}
