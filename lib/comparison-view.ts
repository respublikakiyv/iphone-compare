import type {Product} from './catalog.ts';
import {hasPrice,preferPrice} from './catalog.ts';
import {comparisonGroups,variantKey} from './apple-products.ts';
import {equipmentColor,selectionModel} from './product-selection.ts';
export function priceCardRows(products:Product[],phone=false){
 const groups=phone?[...new Set(products.map(p=>p.color))].map(color=>products.filter(p=>p.color===color)):comparisonGroups(products);
 return groups.filter(offers=>offers.some(p=>hasPrice(p)||p.edition==='OpenBox')).map(offers=>{
  const first=(offers.find(hasPrice)||offers[0])!,row:any={key:phone?first.color:variantKey(first)+'|'+first.store+'|'+first.url,color:equipmentColor(first)||first.color,title:phone?undefined:[selectionModel(first),equipmentColor(first)].filter(Boolean).join(' · '),offers};
  for(const p of offers)if(preferPrice(p,row[p.store]))row[p.store]=p;
  return row;
 }).sort((a,b)=>(phone?0:new Set(b.offers.filter(hasPrice).map((p:Product)=>p.store)).size-new Set(a.offers.filter(hasPrice).map((p:Product)=>p.store)).size)||a.color.localeCompare(b.color)||(a.title||'').localeCompare(b.title||''));
}
