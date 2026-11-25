import {copyPrices,hasPrice,preferPrice,priceLabel,canonicalColor,type Product} from './catalog.ts';
import {appleSku,categoryOf} from './apple-products.ts';
import {allStores} from './stores.ts';
// Plain text survives Telegram draft links without Markdown or fixed-width columns.
export function priceMessage(offers:Product[],rate:string|null){
 copyPrices(offers,rate); // Apply the same price, rate and configuration checks as copying.
 const selected=allStores.flatMap(store=>{
  const best=offers.filter(p=>p.store===store&&hasPrice(p)).reduce<Product|undefined>((best,p)=>preferPrice(p,best)?p:best,undefined);
  return best?[best]:[];
 });
 const first=selected[0];
 const article=(p:Product)=>appleSku(p.full_title||'')||(/^[A-Z][A-Z0-9]{4,11}(?:\/[A-Z])?$/.test(p.sku||'')?p.sku:null);
 const sku=selected.map(article).find(Boolean);
 let title=categoryOf(first)==='iphone'?`${first.edition==='Used'?'Б/У ':''}iPhone ${first.model} ${first.storage.replace(/(GB|TB)$/, ' $1')} ${canonicalColor(first.model,first.color)}`:(first.full_title||first.model).replace(/\s+/g,' ').trim();
 if(sku&&!title.includes(sku))title+=` (${sku})`;
 const money=(value:number)=>Math.round(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g,' ');
 const labels:Record<string,string>={iPeople:'iPeople',Jabko:'Ябко',iSpace:'iSpace',YA:'YA.ua',Foxtrot:'Foxtrot',Comfy:'COMFY'};
 const rows=selected.map(p=>{
  const notes=[p.status==='ok'?'':priceLabel(p),categoryOf(p)==='iphone'&&p.sim==='unknown'&&p.store!=='iSpace'?'SIM не указана':''].filter(Boolean);
  return `${labels[p.store]||p.store}\n${money(Number(p.price))} ₴ · $${money(Number(p.price)/Number(rate))}${notes.length?'\n'+notes.join(' · '):''}`;
 });
 return [title,...rows].join('\n\n');
}
// Exact Telegram username supplied by the user. This link creates a draft.
export const bossUsername='Gerasim_vlad';
export function bossDraftLink(offers:Product[],rate:string|null,recipient=bossUsername){
 if(!/^[A-Za-z][A-Za-z0-9_]{4,31}$/.test(recipient))throw new Error('Некорректный получатель');
 const text=priceMessage(offers,rate);
 return `https://t.me/${recipient}?text=${encodeURIComponent(text)}`;
}

export function bossNativeDraftLink(offers:Product[],rate:string|null,recipient=bossUsername){
 const link=new URL(bossDraftLink(offers,rate,recipient));
 return `tg://resolve?domain=${encodeURIComponent(recipient)}&text=${encodeURIComponent(link.searchParams.get('text')!)}`;
}
// Open the draft inside Telegram, preserving the full text query.
export function openBossDraft(offers:Product[],rate:string|null,recipient:string,telegram:any,navigate:(url:string)=>void){
 const link=bossDraftLink(offers,rate,recipient);
 if(typeof telegram?.openTelegramLink==='function'){
  try{telegram.openTelegramLink(link);return;}catch{}
 }
 navigate(bossNativeDraftLink(offers,rate,recipient));
}
