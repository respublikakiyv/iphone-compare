import type {ProductConfiguration} from './configuration-types.ts';
import {categoryOf,variantKey,comparisonCompatible,observationKeyMatches,type AppleCategory} from './apple-products.ts';
import {allStores,storeLabels} from './stores.ts';
import {plausibleApplePrice} from './product-facts.ts';
export type Product={price_rule?:'new-minus-100-usd';stock_id?:string;configuration?:ProductConfiguration;store:string;url:string;model:string;storage:string;sim:string;color:string;edition?:string;price:string|null;status:string;checked_at:string;full_title?:string|null;sku?:string|null;last_success_at?:string|null;metadata_notice?:string;category?:AppleCategory;variant_key?:string};
export function canonicalColor(model:string,color:string){return /^(?:\d+\s+)?Air(?:\s+\d+)?$/i.test(model)&&color==='Gold'?'Light Gold':['18 Pro','18 Pro Max'].includes(model)&&['Glacier','Glacier Blue'].includes(color)?'Glacier Blue':color;}
export function hasPrice(p?:Product){return !!p&&p.price!==null&&plausibleApplePrice(categoryOf(p),p.price)&&(categoryOf(p)!=='iphone'||Number(p.price)<=300000);}
export function mergeCatalog(previous:any,incoming:any){
 const old=new Map<string,Product>((previous?.products||[]).map((p:Product)=>[p.store+'|'+p.url,p]));
 const products=incoming.products.map((raw:Product)=>{
  const p={...raw,color:canonicalColor(raw.model,raw.color)};
  const before=old.get(p.store+'|'+p.url);old.delete(p.store+'|'+p.url);
  const same=before&&observationKeyMatches(p,before)&&['model','storage','sim','edition'].every(k=>(p as any)[k]===(before as any)[k])&&p.color===canonicalColor(before.model,before.color);
  if(same&&before){p.full_title=p.full_title||before.full_title;p.sku=p.sku||before.sku;}
  if(!hasPrice(p)&&same&&hasPrice(before))return {...p,price:before.price,last_success_at:before.last_success_at||before.checked_at};
  return {...p,last_success_at:hasPrice(p)?p.last_success_at||p.checked_at:null};
 });
 for(const p of old.values())products.push({...p,color:canonicalColor(p.model,p.color),status:'unavailable',last_success_at:p.last_success_at||(hasPrice(p)?p.checked_at:null)});
 return {...incoming,products};
}
export function priceLabel(p?:Product){
 if(!p)return 'Не найдено в загруженной базе';
 if(p.status==='deferred')return hasPrice(p)?'Проверка отложена · последняя цена':'Проверка отложена';
 if(p.status==='unpriced')return hasPrice(p)?'Цена не опубликована · последняя цена':'Цена не опубликована';
 if(!hasPrice(p))return p.status==='unavailable'?'Нет в наличии':'Цена не подтверждена';
 if(['error','unavailable'].includes(p.status))return p.status==='unavailable'?'Нет в наличии · последняя цена':'Последняя подтверждённая цена';
 return p.status==='preorder'?'Под заказ':'В наличии';
}
export function preferPrice(p:Product,old?:Product){
 if(!old)return true;
 if(hasPrice(p)!==hasPrice(old))return hasPrice(p);
 const rank=(p:Product)=>p.status==='ok'?3:p.status==='preorder'?2:0;
 if(rank(p)!==rank(old))return rank(p)>rank(old);
 if(rank(p)>0)return Number(p.price)<Number(old.price);
 return (p.last_success_at||'')>(old.last_success_at||'');
}

export function copyPrices(offers:Product[],rate:string|null){
 if(!rate||!Number.isFinite(Number(rate))||Number(rate)<1||Number(rate)>1000)throw new Error('Установите курс доллара для копирования цен.');
 const priced=offers.filter(hasPrice);
 if(!priced.length)throw new Error('Нет подтверждённых цен для копирования.');
 const first=priced.find(p=>p.sim!=='unknown')||priced[0];
 if(new Set(priced.filter(p=>p.sim!=='unknown').map(p=>p.sim)).size>1)throw new Error('Выберите одну конфигурацию для копирования.');
 if(priced.some(p=>categoryOf(p)==='iphone'&&categoryOf(first)==='iphone'?p.model!==first.model||p.storage!==first.storage||(p.sim!==first.sim&&p.sim!=='unknown'&&first.sim!=='unknown')||(p.edition||'Standard')!==(first.edition||'Standard')||canonicalColor(p.model,p.color)!==canonicalColor(first.model,first.color):!priced.every(other=>comparisonCompatible(p,other))))throw new Error('Выберите одну конфигурацию для копирования.');
 const title=categoryOf(first)==='iphone'?`${first.edition==='Used'?'Б/У ':''}iPhone ${first.model.replace(/Pro/g,'pro')} ${first.storage.replace(/(GB|TB)$/, ' $1')} ${canonicalColor(first.model,first.color)}`:(first.full_title||first.model);

 const lines=allStores.flatMap(store=>{
  const offer=priced.filter(p=>p.store===store).reduce<Product|undefined>((best,p)=>preferPrice(p,best)?p:best,undefined);
  if(!offer)return [];
  return [`${store==='iPeople'?'сайт':store==='Jabko'?'ябко':storeLabels[store]} $${Math.round(Number(offer.price)/Number(rate))} ${Math.round(Number(offer.price))}грн${categoryOf(offer)==='iphone'&&offer.sim==='unknown'&&store!=='iSpace'?' (SIM не указана)':''}`];
 });
 return [title,...lines].join('\n');
}

export function missingPriceReason(store:string,category:AppleCategory,catalog?:{products:Product[];stores:Record<string,any>},job?:{sources?:{store:string;scope?:string;error?:string|null;complete?:boolean}[]}|null){
 const source=job?.sources?.find(s=>s.store===store&&s.scope!=='used'&&!s.complete)||job?.sources?.find(s=>s.store===store&&s.scope!=='used'),error=source?.error||catalog?.stores[store]?.error;
 if(source&&!source.complete)return 'Проверка ещё идёт';
 if(['source_challenge','http_403','http_429','robots_denied','crawl_delay_too_long'].includes(error||''))return 'Магазин блокирует проверку';
 if(!catalog?.products.some(p=>p.store===store&&categoryOf(p)===category))return 'Каталог категории не загружен';
 return 'Не найдено в загруженной базе';
}
