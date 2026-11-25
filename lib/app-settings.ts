import {primaryStores} from './stores.ts';
import {timestampMillis} from './time.ts';
import {hasPrice} from './catalog.ts';
import {belongs} from './inventory.ts';
import type {Catalog} from './device-catalog.ts';
export const storeNames=primaryStores;
export type AppSettings={stores:string[];bossRecipient:string;staleHours:number;defaultRate:string|null;showUsed:boolean;revision:number};
export const defaultSettings:AppSettings={stores:storeNames,bossRecipient:'Gerasim_vlad',staleHours:6,defaultRate:null,showUsed:true,revision:0};
export function validateSettings(value:any):AppSettings{
 if(!value||!Array.isArray(value.stores)||!value.stores.length||value.stores.some((s:any)=>!storeNames.includes(s))||new Set(value.stores).size!==value.stores.length)throw Error('Выберите хотя бы один магазин.');
 if(typeof value.bossRecipient!=='string'||!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(value.bossRecipient))throw Error('Введите Telegram username без @ и ссылки.');
 if(!Number.isFinite(value.staleHours)||value.staleHours<1||value.staleHours>48)throw Error('Порог напоминания: от 1 до 48 часов.');
 if(value.defaultRate!==null&&(!Number.isFinite(Number(value.defaultRate))||Number(value.defaultRate)<1||Number(value.defaultRate)>1000))throw Error('Курс: от 1 до 1000.');
 if(typeof value.showUsed!=='boolean'||!Number.isInteger(value.revision)||value.revision<0)throw Error('Некорректные настройки.');
 return {stores:storeNames.filter(s=>value.stores.includes(s)),bossRecipient:value.bossRecipient,staleHours:value.staleHours,defaultRate:value.defaultRate===null?null:String(Number(value.defaultRate)),showUsed:value.showUsed,revision:value.revision};
}
// Card observations are authoritative; an old store watermark can survive a partial refresh.
export function priceRefreshStatus(catalog:Catalog,stores:string[],hours=6,now=Date.now(),used=false){
 const fresh=(value?:string|null)=>{const stamp=timestampMillis(value);return Number.isFinite(stamp)&&stamp<=now+300000&&now-stamp<=hours*3600000;};
 const staleStores:string[]=[],failedStores:string[]=[],blockedStores:string[]=[];let staleCount=0,failedCount=0;
 for(const store of new Set(stores)){
  const state=catalog.stores[used?store+':used':store];
  const rows=catalog.products.filter(p=>p.store===store&&belongs(p,used?'used':'new'));
  if(!rows.length){if(!fresh(state?.prices_updated_at))staleStores.push(store);continue;}
  const unverified=rows.filter(p=>{
   // A verified 404 is a fresh availability check, while its historical price keeps its own date.
   if(['unavailable','unpriced'].includes(p.status))return !fresh(p.checked_at)&&!(state?.status==='ok'&&fresh(state?.full_updated_at));
   return !hasPrice(p)||!['ok','preorder'].includes(p.status)||!fresh(p.last_success_at||p.checked_at);
  });
  if(!unverified.length)continue;
  if(['source_challenge','http_403','http_429','robots_denied','crawl_delay_too_long'].includes(state?.error))blockedStores.push(store);
  const failures=unverified.filter(p=>p.status==='error'||!hasPrice(p)&&!['unavailable','unpriced'].includes(p.status));
  const staleRows=unverified.length-failures.length;
  if(failures.length){failedStores.push(store);failedCount+=failures.length;}
  if(staleRows){staleStores.push(store);staleCount+=staleRows;}

 }
 return {staleStores,failedStores,blockedStores,staleCount,failedCount,stores:[...new Set([...staleStores,...failedStores])]};
}
export function pricesStale(catalog:Catalog,stores:string[],hours=6,now=Date.now(),used=false){
 return priceRefreshStatus(catalog,stores,hours,now,used).stores.length>0;
}

export function migrateAppSettings(value:Partial<AppSettings>):AppSettings{
 const selected=primaryStores.filter(s=>Array.isArray(value.stores)&&value.stores.includes(s));
 return {...defaultSettings,...value,stores:selected.length?selected:[...primaryStores]};
}
