import type {Product} from './catalog.ts';
import {belongs} from './inventory.ts';
import {searchTokens,searchText} from './apple-products.ts';
import {stockProductKey,type CardStock} from './warehouse-stock.ts';
// Stock in any of the three selected warehouses is the availability source.
export function availableUsedOffers(products:Product[],stock:Record<string,CardStock>,query='',model='',storage=''){
 const tokens=searchTokens(query);
 return products.filter(p=>belongs(p,'used')&&(!model||p.model===model)&&(!storage||p.storage===storage)&&tokens.every(t=>searchText(p).includes(t)))
 .sort((a,b)=>Number(stock[stockProductKey(b)]?.some(n=>typeof n==='number'&&n>0)||false)-Number(stock[stockProductKey(a)]?.some(n=>typeof n==='number'&&n>0)||false)||b.model.localeCompare(a.model,undefined,{numeric:true})||parseInt(a.storage)-parseInt(b.storage)||a.color.localeCompare(b.color)||a.url.localeCompare(b.url))
 .map(p=>({key:p.url,color:p.color,title:p.full_title||`iPhone ${p.model} · ${p.storage} · ${p.color}`,iPeople:p}));
}
