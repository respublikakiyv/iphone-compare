import {appleCategory,appleSku,comparisonArticle,comparisonCompatible,categoryOf} from './apple-products.ts';
import {canonicalColor,type Product} from './catalog.ts';
import {modelOf,memory,simOf,colorOf,norm,isUsed,isNew} from './product-facts.ts';
import {equipmentColor} from './product-selection.ts';
export const stockWarehouses=[
 {label:'Р',name:'Київ, Республіка (Respublika Park)',id:'7f3b76e6-0dad-11ed-0a80-026d00245b55'},
 {label:'Б',name:'Бар',id:'52c2bd4c-474e-11e6-7a69-8f55001bbfda'},
 {label:'А',name:'Київ, Антоновича',id:'681badbf-a709-11ea-0a80-01d800047a76'},
] as const;
export type StockRow={id:string;name:string;article?:string;stock:number;folder?:string};
export type CardStock=(number|null)[];
export const stockProductKey=(p:Product)=>p.store+'|'+p.url;
export function stockSearch(p:Product){
 const category=categoryOf(p),title=p.full_title||p.model;
 if(category==='iphone')return 'iPhone '+p.model.replace(/^17 Air$/,'17 Air');
 const family=/\b(?:MacBook\s+(?:Air|Pro|Neo)|Mac\s+(?:mini|Studio|Pro)|iMac|AirPods(?:\s+(?:Pro|Max))?|iPad(?:\s+(?:Air|Pro|mini))?|Watch(?:\s+(?:Series|Ultra|SE))?|HomePod|AirTag|Pencil|Magic\s+(?:Keyboard|Mouse|Trackpad)|Vision\s+Pro|Apple\s+TV|Studio\s+Display|Pro\s+Display)\b/i.exec(title)?.[0];
 return family?norm(family):null;
}
function articles(row:StockRow){return [...new Set([appleSku(row.name),row.article,...[...row.name.matchAll(/\b([MZ][A-Z0-9]{4,11}(?:\/[A-Z])?)\b/g)].map(m=>m[1])].filter((s):s is string=>!!s&&/^[MZ][A-Z0-9]{4,11}(?:\/[A-Z])?$/.test(s)))];}
export const stockCategory=(name:string)=>appleCategory(name.replace(/^(?:Б\s*[/.-]?\s*[УВ]|Used)\s+/i,''));
export function stockMatches(p:Product,row:StockRow){
 p={...p,sku:appleSku(p.full_title||p.model)||(/^[MZ][A-Z0-9]{4,11}(?:\/[A-Z])?$/.test(p.sku||'')?p.sku:null)};
 if(p.stock_id)return p.edition==='OpenBox'&&row.id===p.stock_id;
 const category=stockCategory(row.name);if(category!==categoryOf(p))return false;
 const used=isUsed(row.name+' '+(row.folder||''));if(used!==((p.edition||'Standard')==='Used')||!used&&(!isNew(row.name)||/\b(?:CPO|Lock|Demo|Refurbished|Ex[ -]?Demo)\b/i.test(row.name)))return false;
 const title=norm(row.name),clean=title.replace(/\([^)]*\)/g,'').trim();
 if(category==='iphone'){
  if(modelOf(title)?.toUpperCase()!==p.model.toUpperCase()||memory(title)!==p.storage)return false;
  const color=colorOf(clean);if(!color||canonicalColor(p.model,color)!==canonicalColor(p.model,p.color))return false;
  // Unlabelled conventional iPhones are physical-SIM stock. Air/Duo are eSIM-only.
  const sim=simOf(title)||(/\b(?:Air|Duo)\b/i.test(p.model)?'esim':'physical');
  if(p.sim!=='unknown')return p.sim===sim;
  const article=comparisonArticle(p);return !!article&&articles(row).some(sku=>comparisonArticle({...p,sku})===article);
 }
 const capacities=[...title.matchAll(/(\d+)\s*(GB|TB|ГБ|ТБ)(?![\p{L}\p{N}])/igu)].map(m=>memory(m[0])!).sort((a,b)=>parseInt(b)*(b.includes('TB')?1024:1)-parseInt(a)*(a.includes('TB')?1024:1));
 const base:Product={store:'MoySklad',url:row.id,category,full_title:title,model:title,storage:capacities[0]||'—',sim:'unknown',color:'—',edition:used?'Used':'Standard',price:null,status:'ok',checked_at:''};
 base.color=equipmentColor(base)||'—';
 const article=comparisonArticle(p);
 if(article)return articles(row).some(sku=>comparisonArticle({...base,sku})===article&&comparisonCompatible(p,{...base,sku}));
 return norm(p.full_title||p.model).toLowerCase()===title.toLowerCase();
}
const titleStockIndex=new WeakMap<StockRow[],Map<string,StockRow[]>>();
const articleStockIndex=new WeakMap<StockRow[],Map<string,StockRow[]>>();
const normalizedArticle=(sku:string)=>sku.replace(/^(M[A-Z0-9]{4})[A-Z0-9]{2}\/A$/,'$1');
const phoneStockIndex=new WeakMap<StockRow[],Map<string,StockRow[]>>();
const phoneKey=(model:string,storage:string,color:string,used:boolean)=>[model.toUpperCase(),storage,canonicalColor(model,color),used].join('|');
export function matchingStockRows(p:Product,rows:StockRow[]){
 if(p.stock_id)return rows.filter(r=>r.id===p.stock_id&&stockMatches(p,r));
 if(categoryOf(p)!=='iphone'){
  const article=comparisonArticle(p);if(!article){
   let index=titleStockIndex.get(rows);if(!index){index=new Map();for(const row of rows){const title=norm(row.name).toLowerCase(),group=index.get(title)||[];group.push(row);index.set(title,group);}titleStockIndex.set(rows,index);}
   return (index.get(norm(p.full_title||p.model).toLowerCase())||[]).filter(row=>stockMatches(p,row));
  }
  let index=articleStockIndex.get(rows);if(!index){index=new Map();for(const row of rows)for(const key of new Set(articles(row).map(normalizedArticle))){const group=index.get(key)||[];group.push(row);index.set(key,group);}articleStockIndex.set(rows,index);}
  return (index.get(article)||[]).filter(row=>stockMatches(p,row));
 }
 let index=phoneStockIndex.get(rows);
 if(!index){index=new Map();for(const row of rows){if(stockCategory(row.name)!=='iphone')continue;const model=modelOf(row.name),storage=memory(row.name),color=colorOf(row.name.replace(/\([^)]*\)/g,''));if(!model||!storage||!color)continue;const key=phoneKey(model,storage,color,isUsed(row.name+' '+(row.folder||''))),group=index.get(key)||[];group.push(row);index.set(key,group);}phoneStockIndex.set(rows,index);}
 return (index.get(phoneKey(p.model,p.storage,p.color,p.edition==='Used'))||[]).filter(row=>stockMatches(p,row));
}
export function quantityFor(p:Product,rows:StockRow[]):number|null{
 const matched=new Map(matchingStockRows(p,rows).map(row=>[row.id,row]));
 if(!matched.size)return null;
 const values=[...matched.values()].map(row=>row.stock);if(values.some(n=>!Number.isFinite(n)||!Number.isInteger(n)))return null;
 return values.reduce((sum,n)=>sum+n,0);
}
export function rowStock(offers:Product[],values:Record<string,CardStock>):CardStock{
 if(offers.some(p=>categoryOf(p)==='iphone'&&p.sim!=='unknown'))offers=offers.filter(p=>categoryOf(p)!=='iphone'||p.sim!=='unknown');
 return stockWarehouses.map((_,i)=>{const found=[...new Set(offers.map(p=>values[stockProductKey(p)]?.[i]).filter((n):n is number=>typeof n==='number'))];return found.length===1?found[0]:null;});
}

export function rowStockDetails(offers:Product[],values:Record<string,CardStock>,verifiedAt:Record<string,(string|null)[]>={}){
 if(offers.some(p=>categoryOf(p)==='iphone'&&p.sim!=='unknown'))offers=offers.filter(p=>categoryOf(p)!=='iphone'||p.sim!=='unknown');
 return rowStock(offers,values).map((quantity,index)=>{
  const known=offers.filter(p=>typeof values[stockProductKey(p)]?.[index]==='number');
  const conflict=quantity===null&&new Set(known.map(p=>values[stockProductKey(p)]?.[index])).size>1;
  const dates=quantity===null?[]:known.map(p=>verifiedAt[stockProductKey(p)]?.[index]).filter((date):date is string=>!!date&&Number.isFinite(Date.parse(date))).sort((a,b)=>Date.parse(b)-Date.parse(a));
  return {quantity,checkedAt:dates[0]||null,conflict};
 });
}
