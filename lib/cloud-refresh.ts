import {priceOpenBoxes} from './open-box-pricing';
import {priceHistoryStatements} from './price-history';
import {packCatalog,unpackCatalog} from './catalog-storage.ts';
import {timestampMillis} from './time.ts';
import {selectionModel} from './product-selection.ts';
import {rootsFor,rootCategory} from './apple-roots.ts';
import {categoryOf,comparisonCompatible,appleCategories,type AppleCategory} from './apple-products.ts';
import {db} from './auth';
import {storePage} from './store-fetch';
import {parsePage,safeUrl} from './store-parser';
import {catalogRoots,allStores,primaryStores} from './stores.ts';
import {belongs,type Inventory} from './inventory.ts';
import {priceObservation,type Catalog} from './device-catalog.ts';
import {norm,modelOf} from './product-facts.ts';
import {canonicalColor,hasPrice,type Product} from './catalog.ts';
import {fetchExchangeRate} from './exchange-rate';
type ReadPage=(store:string,url:string,scope:Inventory,options?:{discovery:boolean})=>Promise<any>;
type Item={url:string;type:'page'|'product';attempts:number;priority?:number};
type Source={duoRepairV2?:boolean;resumeOf?:string;blockedRepairV2?:boolean;dueHours?:number;card?:string;targets?:string[];usedPaginationV2?:boolean;completedAt?:string;model?:string;deferredQueue?:Item[];retryOnly?:boolean;bulkPrices?:boolean;retryAt?:number;blockedStreak?:number;category?:AppleCategory|'all';store:string;scope:Inventory;queue:Item[];seen:string[];found:string[];checked:number;errors:number;error:string|null;complete:boolean;discovery:boolean;pages:number};
export type CloudJob={id:string;kind:'prices'|'catalog';status:string;progress:number;message:string;created:string;updated:string;sources:Source[];requests:number;requestedBy:string};
const covers=(source:Source,requested:Source)=>!source.deferredQueue?.length&&source.store===requested.store&&source.card===requested.card&&(!source.dueHours||!!requested.dueHours&&source.dueHours<=requested.dueHours)&&source.scope===requested.scope&&(!source.category||source.category==='all'||source.category===requested.category)&&(!source.model||source.model===requested.model)&&(!requested.discovery||source.discovery)&&(!source.retryOnly||!!requested.retryOnly);
const checkpoint=(s:Source)=>JSON.stringify([s.store,s.scope,s.category,s.card,s.model,s.discovery,s.checked,s.seen.length,s.completedAt]);
const active=(job:CloudJob|null)=>!!job&&['queued','running'].includes(job.status);
const stamp=()=>new Date().toISOString();
export async function cloudCatalog():Promise<Catalog>{const row=await db().prepare('SELECT payload FROM snapshots WHERE id=?').bind('catalog').first<any>();const catalog=row?await unpackCatalog(row.payload):{products:[],stores:{}};const open=await db().prepare('SELECT payload FROM snapshots WHERE id=?').bind('open-box-catalog').first<any>();if(open)catalog.products.push(...JSON.parse(open.payload).products);const rate=await db().prepare('SELECT payload FROM snapshots WHERE id=?').bind('exchange-rate').first<any>();if(rate){const value=JSON.parse(rate.payload);catalog.products=priceOpenBoxes(catalog.products,value.rate,value.checked_at);}else catalog.products=priceOpenBoxes(catalog.products,null);return catalog;}
export async function cloudJob():Promise<CloudJob|null>{const row=await db().prepare('SELECT payload FROM cloud_refresh WHERE id=?').bind('active').first<any>();return row?JSON.parse(row.payload):null;}
export function publicJob(job:CloudJob|null){if(!job)return null;const {requestedBy,sources,...result}=job;return {...result,sources:sources.map(s=>({store:s.store,scope:s.scope,category:s.category,model:s.model,card:s.card,targets:s.targets,checked:s.checked,errors:s.errors,error:s.error,complete:s.complete,remaining:s.queue.length,deferred:s.deferredQueue?.length||0}))};}
export async function enqueueRefresh(user:string,kind='prices',stores:string[]=primaryStores,scope:Inventory|'all'='new',category:AppleCategory|'all'='all',retryOnly=false,model='',targets?:{store:string;url:string}[],dueHours=0){
 if(typeof model!=='string'||model.length>160||model!==model.trim()||model&&((kind!=='prices'&&!(kind==='catalog'&&scope==='used'&&model==='17 Air'))||category==='all'))throw Error('Invalid model');
 if(!Number.isFinite(dueHours)||dueHours<0||dueHours>48||dueHours&&(kind!=='prices'||retryOnly||model||targets!==undefined))throw Error('Invalid due interval');
 if(typeof retryOnly!=='boolean'||retryOnly&&kind!=='prices')throw Error('Invalid refresh');
 if(category!=='all'&&!appleCategories.includes(category))throw Error('Invalid category');
 if(!['prices','catalog'].includes(kind)||!['new','used','all'].includes(scope)||!Array.isArray(stores)||!stores.length||stores.some(s=>!allStores.includes(s)))throw Error('Invalid refresh');
 const existing=await cloudJob();
 const catalog=await cloudCatalog();const sources:Source[]=[];
 let card:string|undefined;
 if(targets!==undefined){
  if(kind!=='prices'||scope==='all'||category==='all'||retryOnly||!Array.isArray(targets)||!targets.length||targets.length>48)throw Error('Invalid card');
  const selected:Product[]=[];
  targets=targets.map(t=>{
   if(!t||typeof t.store!=='string'||typeof t.url!=='string'||!stores.includes(t.store))throw Error('Invalid card');
   const url=safeUrl(t.url,t.store),p=catalog.products.find(p=>p.store===t.store&&p.url===url&&belongs(p,scope)&&categoryOf(p)===category&&(!model||selectionModel(p)===model));
   if(!p)throw Error('Unknown card product');selected.push(p);return {store:t.store,url};
  });
  const first=selected[0],known=selected.filter(p=>p.sim!=='unknown');
  if(new Set(known.map(p=>p.sim)).size>1||selected.some(p=>category==='iphone'?p.model!==first.model||p.storage!==first.storage||(p.edition||'Standard')!==(first.edition||'Standard')||canonicalColor(p.model,p.color)!==canonicalColor(first.model,first.color):selected.some(other=>!comparisonCompatible(p,other))))throw Error('Invalid card configuration');
  targets=[...new Map(targets.map(t=>[t.store+'|'+t.url,t])).values()].sort((a,b)=>(a.store+'|'+a.url).localeCompare(b.store+'|'+b.url));
  card=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(targets))))).map(n=>n.toString(16).padStart(2,'0')).join('');
 }
 for(const inventory of scope==='all'?['new','used'] as Inventory[]:[scope as Inventory])for(const store of [...new Set(inventory==='used'?['iPeople']:stores)]){
  if(card&&!targets!.some(t=>t.store===store))continue;
  const saved=existing?.sources.find(s=>s.store===store&&s.scope===inventory&&s.discovery===(kind==='catalog')&&s.card===card&&(!model||s.model===model)&&(s.category||'all')===(inventory==='used'?'iphone':category)&&s.deferredQueue?.length);
  if(saved){const resumed:Source=JSON.parse(JSON.stringify(saved));resumed.resumeOf=checkpoint(saved);resumed.queue=resumed.deferredQueue!;delete resumed.deferredQueue;resumed.complete=false;resumed.blockedStreak=0;
   // A new user request is an explicit retry after the retailer's temporary
   // challenge. Do not retain the old cooldown, otherwise “continue checking”
   // appears to do nothing for up to five minutes.
   resumed.retryAt=0;resumed.errors=Math.max(0,resumed.errors-1);resumed.error=resumed.errors?'previous_verification_errors':null;const pendingKeys=new Set(resumed.queue.map(item=>item.type+'|'+item.url));resumed.seen=resumed.seen.filter(key=>!pendingKeys.has(key));sources.push(resumed);continue;}
  const oldAll=catalog.products.filter(p=>!p.stock_id&&p.store===store&&belongs(p,inventory)&&(inventory==='used'||category==='all'||categoryOf(p)===category)&&(!model||selectionModel(p)===model)&&(!card||targets!.some(t=>t.store===p.store&&t.url===p.url)));const candidates=dueHours?oldAll.filter(p=>{const checked=timestampMillis(['unavailable','unpriced'].includes(p.status)?p.checked_at:p.last_success_at||p.checked_at);return ['error','deferred'].includes(p.status)||!['unavailable','unpriced'].includes(p.status)&&!hasPrice(p)||!Number.isFinite(checked)||checked>Date.now()+300000||Date.now()-checked>=dueHours*3600000;}):oldAll;if(dueHours&&!candidates.length)continue;const old=retryOnly?oldAll.filter(p=>p.status==='error'||!['unavailable','unpriced'].includes(p.status)&&!hasPrice(p)):candidates;const missingDuo=store==='Jabko'&&inventory==='new'&&category==='iphone'&&model==='Duo'&&!oldAll.length;const discovery=!dueHours&&!card&&(!model||missingDuo||kind==='catalog'&&scope==='used'&&model==='17 Air')&&(kind==='catalog'||!oldAll.length);
  const missingRoots=!dueHours&&!card&&!model&&!retryOnly&&!discovery&&inventory==='new'?rootsFor(store,category).filter(url=>!old.some(p=>categoryOf(p)===rootCategory(store,url))):[];
  const bulkPrices=!dueHours&&!card&&!model&&store==='iSpace'&&inventory==='new'&&kind==='prices'&&!retryOnly;
  const urls=discovery?(missingDuo?['https://jabko.ua/iphone/apple-iphone-duo/']:inventory==='used'?[model==='17 Air'?'https://ipeople.ua/b-u-tekhnyka-ua/b-u-iphone-ua/b-u-iphone-17-air':'https://ipeople.ua/b-u-tekhnyka-ua/b-u-iphone-ua']:rootsFor(store,category)):[...new Set(old.map(p=>p.url))];
  sources.push({blockedRepairV2:true,dueHours:dueHours||undefined,card,targets:card?targets!.filter(t=>t.store===store).map(t=>t.url):undefined,usedPaginationV2:inventory==='used'&&discovery?true:undefined,model:model||undefined,bulkPrices,retryOnly,category:inventory==='used'?'iphone':category,store,scope:inventory,queue:[...(bulkPrices?rootsFor(store,category):[]).map(url=>({url,type:'page' as const,attempts:0,priority:0})),...missingRoots.filter(url=>!bulkPrices).map(url=>({url,type:'page' as const,attempts:0,priority:0})),...urls.map(url=>({url,type:discovery?'page' as const:'product' as const,attempts:0,priority:discovery?0:bulkPrices?3:1}))],seen:[],found:[],checked:0,errors:0,error:null,complete:false,discovery,pages:0});
 }
 // Reuse a recent result only if it actually covered this model and scope.
 if(existing&&!active(existing)&&Date.now()-Date.parse(existing.updated)<60000&&sources.every(requested=>existing.sources.some(source=>covers(source,requested)&&!(requested.scope==='used'&&requested.discovery&&!source.usedPaginationV2))))return existing;
 // New stores requested during a leased batch are durable commands. The next
 // batch adopts them; the current checkpoint cannot overwrite the request.
 if(active(existing)){
  for(const source of sources){
   if(existing!.sources.some(s=>(!s.complete||(s.model||s.card)&&s.completedAt&&Date.now()-Date.parse(s.completedAt)<60000)&&covers(s,source)&&(!source.model||s.model===source.model)))continue;
   const id='pending:'+existing!.id+':'+source.store+':'+source.scope+':'+source.category+':'+(source.discovery?'catalog':'prices')+':'+(source.retryOnly?'retry':'full')+':'+encodeURIComponent(source.model||'')+':'+(source.card||'')+':'+(source.dueHours||0);
   await db().prepare('INSERT OR IGNORE INTO cloud_refresh(id,payload,lease,token,updated) VALUES(?,?,0,?,?)').bind(id,JSON.stringify(source),'',stamp()).run();
  }
  return existing!;
 }
 const job:CloudJob={id:crypto.randomUUID(),kind:kind as CloudJob['kind'],status:'queued',progress:0,message:card?'Обновляем цены карточки.':model?'Обновляем цены модели '+model+'.':sources.some(s=>s.checked>0)?'Продолжаем каталог с сохранённого места.':'Обновление поставлено в серверную очередь.',created:stamp(),updated:stamp(),sources,requests:0,requestedBy:user};
 const previous=existing?JSON.stringify(existing):null;
 const result=existing?await db().prepare('UPDATE cloud_refresh SET payload=?,updated=?,lease=0,token=? WHERE id=? AND payload=? AND lease<=?').bind(JSON.stringify(job),stamp(),'','active',previous,Date.now()).run():await db().prepare('INSERT OR IGNORE INTO cloud_refresh(id,payload,lease,token,updated) VALUES(?,?,0,?,?)').bind('active',JSON.stringify(job),'',stamp()).run();
 return result.meta.changes?job:(await cloudJob())!;
}
const duoItem=(item:Pick<Item,'url'|'type'>)=>{const path=new URL(item.url).pathname;return item.type==='page'?path.replace(/\/$/,'')==='/iphone/apple-iphone-duo':modelOf(decodeURIComponent(path).replace(/-/g,' '))?.toLowerCase()==='duo';};
const queueIndex=new WeakMap<Source,Set<string>>();
function add(source:Source,url:string,type:Item['type']){url=safeUrl(url,source.store);if(source.store==='Jabko'&&source.scope==='new'&&source.model==='Duo'&&!duoItem({url,type}))return;if(type==='page'&&source.scope==='used'&&source.model==='17 Air'&&new URL(url).pathname.replace(/\/$/,'')!=='/b-u-tekhnyka-ua/b-u-iphone-ua/b-u-iphone-17-air')return;if(type==='page'&&source.scope==='new'&&source.category&&source.category!=='all'&&rootCategory(source.store,url)!==source.category)return;const key=type+'|'+url;let keys=queueIndex.get(source);if(!keys){keys=new Set([...source.seen,...source.queue.map(i=>i.type+'|'+i.url)]);queueIndex.set(source,keys);}if(!keys.has(key)){keys.add(key);source.queue.push({url,type,attempts:0,priority:source.bulkPrices?(type==='page'?0:3):undefined});}}
const productIndex=new WeakMap<Catalog,Map<string,number>>();
function indexFor(catalog:Catalog){let index=productIndex.get(catalog);if(!index){index=new Map(catalog.products.map((p,i)=>[p.store+'|'+p.url,i]));productIndex.set(catalog,index);}return index;}
function upsert(catalog:Catalog,p:Product){const map=indexFor(catalog),key=p.store+'|'+p.url,index=map.get(key);if(index===undefined){map.set(key,catalog.products.length);catalog.products.push(p);}else catalog.products[index]=p;}
const inSource=(p:Product,s:Source)=>p.store===s.store&&belongs(p,s.scope)&&(!s.category||s.category==='all'||categoryOf(p)===s.category)&&(!s.model||selectionModel(p)===s.model)&&(!s.targets||s.targets.includes(p.url));
function finish(source:Source,catalog:Catalog,kind:string){
 if(source.queue.length)return;source.complete=true;if(source.model||source.card){source.completedAt=stamp();return;}const now=stamp(),key=source.scope==='used'?source.store+':used':source.store,previous=catalog.stores[key]||{};
 if(source.discovery&&!source.checked&&!source.errors){source.errors++;source.error='no_verified_variants';}
 if(source.discovery&&!source.errors){catalog.products=catalog.products.map(p=>inSource(p,source)&&!source.found.includes(p.url)?{...p,status:'unavailable',checked_at:now,last_success_at:p.last_success_at||(p.price?p.checked_at:null)}:p);}
 catalog.stores[key]={...previous,status:source.errors?(source.checked?'partial':'error'):'ok',error:source.error,message:`Проверено: ${source.checked}. Ошибок: ${source.errors}.${source.deferredQueue?.length?' Ещё не проверено: '+source.deferredQueue.length+'. Повтор продолжит проверку.':''}`,updated_at:now,prices_updated_at:source.errors?previous.prices_updated_at:now,full_updated_at:source.discovery&&!source.errors?now:previous.full_updated_at};
}
export async function advanceSource(source:Source,catalog:Catalog,read:ReadPage){
 // Root pages first, then verify discovered products before expanding child categories.
 source.queue.sort((a,b)=>(a.priority??(a.type==='product'?1:2))-(b.priority??(b.type==='product'?1:2)));
 const item=source.queue.shift();if(!item)return;const index=indexFor(catalog).get(source.store+'|'+item.url),old=index===undefined?undefined:catalog.products[index];const key=item.type+'|'+item.url;
 try{
  if(item.type==='page'&&source.pages>=150)throw Error('pagination_limit');
  const result=await read(source.store,item.url,source.scope,{discovery:item.type==='page'||source.discovery});source.blockedStreak=0;source.retryAt=0;if(result.gone)throw Error('http_404');
  if(!source.seen.includes(key))source.seen.push(key);
  if(item.type==='page'){
   if(!result.catalogPage)throw Error('layout_changed');source.pages++;
   if(source.bulkPrices&&source.store==='iSpace'){
    const updated=new Set<string>();
    for(const card of result.priceCards||[]){
     const at=indexFor(catalog).get(source.store+'|'+card.url),before=at===undefined?null:catalog.products[at];
     if(!before||!inSource(before,source)||!before.sku||before.sku!==card.sku||norm(before.full_title||'')!==card.full_title||source.seen.includes('product|'+card.url))continue;
     const now=stamp(),record={...before,price:card.price,status:card.status,checked_at:now,last_success_at:now};
     if(!hasPrice(record)||!['ok','preorder','unavailable'].includes(record.status))continue;
     upsert(catalog,record);updated.add(card.url);source.seen.push('product|'+card.url);source.found.push(card.url);source.checked++;
    }
    if(updated.size){source.queue=source.queue.filter(i=>i.type!=='product'||!updated.has(i.url));queueIndex.delete(source);}
   }
   for(const url of result.urls||[])add(source,url,'product');
   if(!source.bulkPrices)for(const url of result.categories||[])add(source,url,'page');if(result.next)add(source,result.next,'page');
  }else{
   const record=result.record&&inSource(result.record,source)?result.record:null;
   if(record){const observed=old?priceObservation(old,record):record;upsert(catalog,observed);source.found.push(item.url);if(observed.status==='error')throw Error('unverified_product');source.checked++;}
   else if(!result.ignored&&(!result.record||source.model||source.card))throw Error('unverified_product');
   if(source.discovery)for(const url of result.variants||[])add(source,url,'product');
  }
  if(!source.seen.includes(key))source.seen.push(key);
 }catch(e:any){
  const reason=e.message||'network_error',blocked=['http_403','http_429','robots_denied','source_challenge','crawl_delay_too_long'].includes(reason);
  if(reason==='crawl_busy'){
   // Respect the persisted per-store slot without spending Worker CPU sleeping.
   source.queue.unshift({...item,attempts:item.attempts});
   source.retryAt=Date.now()+Math.max(1000,Number(e.retryAfter||1)*1000);
   return;
  }
  if(reason==='source_challenge'){
   source.blockedStreak=(source.blockedStreak||0)+1;
   if(source.blockedStreak<3&&item.attempts<2){source.queue.push({...item,attempts:item.attempts+1});source.retryAt=Date.now()+30000;return;}
  }
  const permanent=blocked||['http_404','unverified_product','layout_changed','pagination_limit','foreign_url','response_too_large'].includes(reason);
  if(!permanent&&item.attempts<2){source.queue.unshift({...item,attempts:item.attempts+1});return;}
  source.seen.push(key);
  if(reason==='http_404'&&item.type==='product'){source.checked++;source.found.push(item.url);if(old)upsert(catalog,{...old,status:'unavailable',checked_at:stamp(),last_success_at:old.last_success_at||(old.price?old.checked_at:null)});return;}
  source.errors++;source.error=reason;
  if(old)upsert(catalog,{...old,status:'error',checked_at:stamp(),last_success_at:old.last_success_at||(old.price?old.checked_at:null)});
  if((blocked&&(reason!=='source_challenge'||(source.blockedStreak||0)>=3))||reason==='pagination_limit'){
   // Unvisited URLs are deferred work, not failed price observations.
   source.deferredQueue=[{...item,attempts:0},...source.queue.map(i=>({...i,attempts:0}))];
   if(blocked)source.retryAt=Date.now()+5*60000;
   source.blockedRepairV2=true;source.queue=[];
  }
  else if(item.type==='page')for(const p of catalog.products.filter(p=>inSource(p,source)))add(source,p.url,'product');
 }
}
export async function runRefreshStep(options:{read?:ReadPage;budgetMs?:number}={}){
 const d=db(),token=crypto.randomUUID(),now=Date.now();
 const lock=await d.prepare('UPDATE cloud_refresh SET lease=?,token=? WHERE id=? AND lease<=?').bind(now+120000,token,'active',now).run();
 if(!lock.meta.changes)return {job:publicJob(await cloudJob()),busy:true};
 try{
  const job=await cloudJob();if(!job)return {job:null};
  const pending=await d.prepare('SELECT id,payload FROM cloud_refresh WHERE id LIKE ?').bind('pending:'+job.id+':%').all<{id:string;payload:string}>();
  const catalog=await cloudCatalog();const beforeProducts=[...catalog.products],openProducts=catalog.products.filter(p=>!!p.stock_id);catalog.products=catalog.products.filter(p=>!p.stock_id);let repairedBlocked=false;
  // Earlier versions marked an entire stopped price queue as failed. Its unchanged
  // check dates identify URLs that were never requested during that job.
  for(const source of job.sources)if(source.complete&&!source.discovery&&!source.blockedRepairV2&&['source_challenge','http_403','http_429','robots_denied','crawl_delay_too_long'].includes(source.error||'')){
   const deferred=catalog.products.filter(p=>inSource(p,source)&&p.status==='error'&&!source.found.includes(p.url));
   source.deferredQueue=deferred.map(p=>({url:p.url,type:'product',attempts:0}));
   for(const p of deferred)if(timestampMillis(p.checked_at)<timestampMillis(job.created))upsert(catalog,{...p,status:'deferred'});
   source.retryAt=Math.max(source.retryAt||0,...deferred.map(p=>timestampMillis(p.checked_at)+5*60000));source.blockedRepairV2=true;repairedBlocked=true;
  }
  // Remove navigation branches accidentally expanded by earlier model discovery.
  for(const source of job.sources)if(source.store==='Jabko'&&source.scope==='new'&&source.model==='Duo'&&source.discovery){
   const wrong=new Set(source.seen.filter(key=>{const at=key.indexOf('|');return at>0&&!duoItem({type:key.slice(0,at) as Item['type'],url:key.slice(at+1)});}));
   const failed=new Set(!source.duoRepairV2&&source.error==='unverified_product'?source.seen.filter(key=>key.startsWith('product|')&&!wrong.has(key)&&!source.found.includes(key.slice(8))):[]);
   const keep=source.queue.filter(duoItem),queued=new Set(keep.map(i=>i.type+'|'+i.url));for(const key of failed)if(!queued.has(key))keep.push({type:'product',url:key.slice(8),attempts:0});
   if(!source.duoRepairV2||wrong.size||failed.size||keep.length!==source.queue.length){source.duoRepairV2=true;source.queue=keep;source.seen=source.seen.filter(key=>!wrong.has(key)&&!failed.has(key));source.errors=Math.max(0,source.errors-[...wrong].filter(key=>key.startsWith('product|')).length-failed.size);if(!source.errors)source.error=null;if(keep.length)source.complete=false;repairedBlocked=true;}
  }
  if(!active(job)&&!pending.results.length&&!repairedBlocked)return {job:publicJob(job)};
  for(const command of pending.results){const source:Source=JSON.parse(command.payload);if(!job.sources.some(s=>!s.complete&&covers(s,source)&&(!source.model||s.model===source.model))){if(source.resumeOf)job.sources=job.sources.filter(s=>checkpoint(s)!==source.resumeOf);if(source.card||source.model||source.scope==='used')job.sources.unshift(source);else job.sources.push(source);}}
  job.sources.sort((a,b)=>(a.card?0:a.model?1:a.scope==='used'?2:3)-(b.card?0:b.model?1:b.scope==='used'?2:3));
  job!.status='running';
  // Older checkpoints discarded used pagination through the new-stock category guard.
  // Re-read the root once, retaining already checked products and their prices.
  for(const source of job.sources)if(source.scope==='used'&&source.discovery&&!source.usedPaginationV2){source.usedPaginationV2=true;source.complete=false;const root='https://ipeople.ua/b-u-tekhnyka-ua/b-u-iphone-ua';source.seen=source.seen.filter(key=>key!=='page|'+root);add(source,root,'page');}
  // Upgrade an already queued price job without discarding its checkpoint.
  for(const source of job.sources)if(source.store==='iSpace'&&source.scope==='new'&&!source.discovery&&!source.complete&&!source.bulkPrices&&!source.model&&!source.card&&!source.dueHours){
   source.bulkPrices=true;source.queue=source.queue.map(item=>({...item,priority:item.type==='page'?0:3}));
   for(const root of rootsFor(source.store,source.category||'all'))add(source,root,'page');
  }
  for(const source of job.sources)if(source.bulkPrices)source.queue=source.queue.filter(item=>item.type!=='page'||!!rootCategory(source.store,item.url));
  const read:ReadPage=options.read|| (async(store,url,scope,parseOptions)=>parsePage(store,await storePage(store,url),url,scope,parseOptions));
  // Cloudflare's free Workers CPU allowance is intentionally small. Keep every
  // continuation short; the browser schedules the next step and the durable
  // checkpoint makes progress without losing a partially scanned catalog.
  const deadline=Date.now()+(options.budgetMs??350);
  // Each host advances independently: a slow shop never holds up another one.
  // Reserve each request before awaiting quota, keeping concurrent lanes bounded.
  let exhausted=false;
  const cardBatch=job.sources.some(s=>s.card&&!s.complete);
  await Promise.all([...new Set(job!.sources.filter(s=>!cardBatch||s.card&&!s.complete).map(s=>s.store))].map(async store=>{
   do{
    const source=job!.sources.find(s=>s.store===store&&!s.complete&&(!cardBatch||s.card));if(!source||exhausted||(source.retryAt||0)>Date.now())return;
    if(!source.queue.length){finish(source,catalog,job!.kind);continue;}
    if(job!.requests>=8000){exhausted=true;return;}
    job!.requests++;
    const airImport=source.discovery&&source.scope==='used'&&source.model==='17 Air';
    const day='budget:'+new Date().toISOString().slice(0,10)+(airImport?':used-air':'');
    const requestLimit=airImport?32:8000;
    const quota=await d.prepare("INSERT INTO cloud_refresh(id,payload,lease,token,updated) VALUES(?,?,0,'',?) ON CONFLICT(id) DO UPDATE SET payload=json_set(cloud_refresh.payload,'$.used',json_extract(cloud_refresh.payload,'$.used')+?) WHERE json_extract(cloud_refresh.payload,'$.used')+?<=?").bind(day,JSON.stringify({used:1}),stamp(),1,1,requestLimit).run();
    if(!quota.meta.changes){job!.requests--;exhausted=true;return;}
    await advanceSource(source,catalog,read);finish(source,catalog,job!.kind);
   }while(Date.now()<deadline);
  }));
  if(exhausted)for(const source of job!.sources.filter(s=>!s.complete)){source.errors++;source.error='daily_budget';if(source.discovery)source.deferredQueue=source.queue.map(item=>({...item,attempts:0}));source.queue=[];finish(source,catalog,job!.kind);}

  const done=job!.sources.every(s=>s.complete),errors=job!.sources.reduce((n,s)=>n+s.errors,0),checked=job!.sources.reduce((n,s)=>n+s.checked,0),remaining=job!.sources.reduce((n,s)=>n+s.queue.length,0);
  job!.progress=done?100:Math.max(job!.progress,Math.min(99,Math.floor(100*checked/Math.max(1,checked+remaining))));job!.status=done?(errors?'partial':'succeeded'):'running';job!.updated=stamp();const jobCard=job.sources.every(s=>s.card&&s.card===job.sources[0]?.card);const jobModel=job.sources.every(s=>s.model===job.sources[0]?.model)?job.sources[0]?.model:undefined;job!.message=done&&jobCard?(errors?'Не все цены карточки обновились. Проверьте статусы магазинов.':'Цены карточки обновлены.'):done?(errors?(jobModel?'Не все цены модели '+jobModel+' обновились. Подробности — в магазинах.':'Обновление завершено частично. Подробности — в магазинах.'):(jobModel?'Цены модели '+jobModel+' обновлены.':'Запрошенные предложения проверены.')):`Проверено ${checked}, в очереди ${remaining}. Результаты сохраняются на сервере.`;catalog.updated_at=stamp();
  const rateRow=await d.prepare('SELECT payload FROM snapshots WHERE id=?').bind('exchange-rate').first<any>(),rate=rateRow?JSON.parse(rateRow.payload):null;
  const history=await priceHistoryStatements(beforeProducts,priceOpenBoxes([...catalog.products,...openProducts],rate?.rate,rate?.checked_at),token);
  const payload=await packCatalog(catalog);
  // Both changes commit atomically and only while we still own the lease.
  await d.batch([
   ...history,
   d.prepare('INSERT INTO snapshots(id,payload,updated) SELECT ?,?,? WHERE EXISTS(SELECT 1 FROM cloud_refresh WHERE id=? AND token=?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated=excluded.updated').bind('catalog',payload,stamp(),'active',token),
   d.prepare('UPDATE cloud_refresh SET payload=?,updated=? WHERE id=? AND token=?').bind(JSON.stringify(job),stamp(),'active',token),
   ...pending.results.map(command=>d.prepare('DELETE FROM cloud_refresh WHERE id=? AND EXISTS(SELECT 1 FROM cloud_refresh WHERE id=? AND token=?)').bind(command.id,'active',token))
  ]);
  const waiting=job.sources.filter(s=>!s.complete);const retryAfterMs=waiting.length&&waiting.every(s=>(s.retryAt||0)>Date.now())?Math.max(1000,Math.min(...waiting.map(s=>s.retryAt!))-Date.now()):0;
  return {job:publicJob(await cloudJob()),retryAfterMs};
 }finally{await d.prepare('UPDATE cloud_refresh SET lease=0,token=? WHERE id=? AND token=?').bind('','active',token).run();}
}
export async function sharedRate(){try{const rate=await fetchExchangeRate();await db().prepare('INSERT INTO snapshots(id,payload,updated) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated=excluded.updated').bind('exchange-rate',JSON.stringify(rate),stamp()).run();return rate;}catch{return null;}}
// Import only addresses from legacy device caches; never trust client-submitted prices.
export async function importDeviceUrls(user:string,items:any[]){
 if(!Array.isArray(items)||items.length>2000)throw Error('Invalid import');
 const catalog=await cloudCatalog(),known=new Set(catalog.products.map(p=>p.store+'|'+p.url));
 const missing=items.filter(p=>allStores.includes(p?.store)&&typeof p.url==='string'&&['new','used'].includes(p.scope)&&!(p.scope==='used'&&p.store!=='iPeople')).map(p=>({store:p.store,url:safeUrl(p.url,p.store),scope:p.scope})).filter(p=>!known.has(p.store+'|'+p.url));
 if(!missing.length)return {imported:0};
 const existing=await cloudJob();if(active(existing))return {deferred:true,imported:0};
 const job=await enqueueRefresh(user,'prices',[...new Set(missing.map(p=>p.store))],'all');if(!active(job))return {deferred:true,imported:0};
 const before=JSON.stringify(job);for(const p of missing){const source=job.sources.find(s=>s.store===p.store&&s.scope===p.scope);if(source)add(source,p.url,'product');}
 const update=await db().prepare('UPDATE cloud_refresh SET payload=? WHERE id=? AND payload=? AND lease<=?').bind(JSON.stringify(job),'active',before,Date.now()).run();return {imported:update.meta.changes?missing.length:0,deferred:!update.meta.changes};
}
