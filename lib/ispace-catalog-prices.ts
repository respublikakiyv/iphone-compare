import type {load} from 'cheerio/slim';
import {norm} from './product-facts.ts';
import {safeStoreUrl} from './stores.ts';
export type CatalogPriceCard={url:string;full_title:string;sku:string;price:string;status:string};
const actions:Record<string,string>={buy:'ok',addToCart:'ok',add_to_cart:'ok',preorder:'preorder',force_preorder:'preorder',coming_soon:'unavailable',unavailable:'unavailable',notify:'unavailable',notify_me:'unavailable'};
// Catalog observations are accepted only when public Nuxt data and the visible
// price card agree. These tuples can update an existing exact identity only.
export function ispaceCatalogPrices($:ReturnType<typeof load>,url:string):CatalogPriceCard[]{
 let entries:any[];try{entries=JSON.parse($('#__NUXT_DATA__').text());}catch{return [];}
 if(!Array.isArray(entries)||entries.length>40000)return [];
 const scalar=(ref:any)=>Number.isInteger(ref)&&ref>=0&&ref<entries.length&&['string','number','boolean'].includes(typeof entries[ref])?entries[ref]:null;
 const candidates=new Map<string,CatalogPriceCard[]>();
 for(const entry of entries){
  if(!entry||typeof entry!=='object'||Array.isArray(entry))continue;
  const slug=scalar(entry.slug),sku=scalar(entry.sku),name=scalar(entry.name),price=scalar(entry.finalPrice),action=scalar(entry.availableAction);
  if(typeof slug!=='string'||!/^[a-z0-9-]+$/i.test(slug)||typeof sku!=='string'||typeof name!=='string'||typeof price!=='number'||price<100||price>1000000||!actions[action as string]||scalar(entry.vendorName)!=='APPLE')continue;
  const target=safeStoreUrl('/product/'+slug,'iSpace',url),card={url:target,sku,full_title:norm(name),price:String(price),status:actions[action as string]};
  candidates.set(target,[...(candidates.get(target)||[]),card]);
 }
 const verified=new Map<string,CatalogPriceCard>(),conflicts=new Set<string>();
 $('a.entity-card_name[href],a.entity-card_title[href]').each((_,element)=>{
  try{
   const target=safeStoreUrl($(element).attr('href')!,'iSpace',url),name=norm($(element).text()),card=$(element).closest('.carousel-product');
   const prices=new Set(card.find('.carousel-product_price-value').toArray().map(e=>norm($(e).text())).map(text=>/^(\d[\d\s]*(?:[.,]\d{2})?)\s*(?:₴|грн|UAH)$/.exec(text)).filter(Boolean).map(m=>String(Number(m![1].replace(/\s/g,'').replace(',','.')))));
   const matches=(candidates.get(target)||[]).filter(p=>p.full_title===name&&prices.size===1&&prices.has(p.price));
   if(!matches.length)return;
   const unique=new Set(matches.map(p=>[p.sku,p.price,p.status,p.full_title].join('|')));if(unique.size!==1){conflicts.add(target);return;}
   const before=verified.get(target),record=matches[0];if(before&&JSON.stringify(before)!==JSON.stringify(record)){conflicts.add(target);return;}
   verified.set(target,record);
  }catch{}
 });
 return [...verified.values()].filter(p=>!conflicts.has(p.url));
}
