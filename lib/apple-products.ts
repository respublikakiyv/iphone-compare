import type {Product} from './catalog.ts';
import {selectionModel,hardwareRam,hardwareTitle,equipmentColor,hardwareFilters} from './product-selection.ts';
import {norm,isNew} from './product-facts.ts';
export const appleCategories=['iphone','ipad','mac','watch','airpods','other'] as const;
export type AppleCategory=typeof appleCategories[number];
export const categoryLabels:Record<AppleCategory,string>={iphone:'iPhone',ipad:'iPad',mac:'Mac',watch:'Apple Watch',airpods:'AirPods',other:'Другая Apple'};
export function appleCategory(title:string):AppleCategory|null{
 const value=norm(title).replace(/^(?:Навушники|Наушники)\s+(?:(?:вкладиші|вкладыши|бездротові|беспроводные|накладні|накладные|внутрішньоканальні|повнорозмірні|полноразмерные|TWS)\s+)+(?=Apple\s+AirPods\b)/i,'').replace(/^(?:(?:Бездротові|Беспроводные|Стаціонарний|Розумний|Розумні|Смарт|Смарт-|Смарт\s*-\s*)\s*)?(?:Смартфон|Планшет(?:ний комп.?ютер)?|Ноутбук|Моноблок|Комп.?ютер|Навушники|Наушники|Гарнітура|Гарнитура|Годинник|Годинники|Часы|медіаплеєр|Медіаплеєр|Колонка|Акустична система|Стилус|Трекер|Смарт-годинник)\s+/i,'').replace(/^Apple\s+/i,'');
 if(/^iPhone\s/i.test(value))return 'iphone';if(/^iPad\b/i.test(value))return 'ipad';
 if(/^(?:MacBook|iMac|Mac\s+(?:mini|Studio|Pro)|Studio Display|Pro Display)\b/i.test(value))return 'mac';
 if(/^Watch\b/i.test(value))return 'watch';if(/^AirPods\b/i.test(value))return 'airpods';
 if(/^(?:TV\s|HomePod\b|Vision\s|AirTag\b|Pencil\b|Magic\s+(?:Keyboard|Mouse|Trackpad)|MagSafe\b)/i.test(value))return 'other';return null;
}
export const categoryOf=(p:Product):AppleCategory=>p.category||'iphone';
export const appleNew=(title:string)=>isNew(appleCategory(title)==='watch'?title.replace(/\bUltra\b/ig,''):title);
export function appleSku(title:string){
 const enclosed=[...title.matchAll(/\(([A-Z][A-Z0-9]{4,11}(?:\/[A-Z])?)\)/g)];if(enclosed.length)return enclosed.at(-1)![1];
 // Retailers also write manufacturer articles without parentheses. Never use
 // a retailer's numeric internal product ID as an Apple article.
 const bare=[...title.matchAll(/(?:^|[\s(])([MZ][A-Z0-9]{4,11}(?:\/[A-Z])?)(?=$|[\s)])/g)].map(m=>m[1]).filter(value=>/\d/.test(value));
 return new Set(bare).size===1?bare[0]:null;
}
export function appleModel(title:string){return norm(title).replace(/^.*?(?=(?:Apple\s+)?(?:iPad|MacBook|iMac|Mac\s|Watch\b|AirPods|TV\s|HomePod|Vision|AirTag|Pencil|Magic\s|Studio Display|Pro Display))/i,'').replace(/^Apple\s+/i,'').replace(/\s*\([A-Z][A-Z0-9]{4,11}(?:\/[A-Z])?\)/g,'').trim();}
export function variantKey(p:Product){if(categoryOf(p)==='iphone')return ['iphone',p.model,p.storage,p.sim,['18 Pro','18 Pro Max'].includes(p.model)&&['Glacier','Glacier Blue'].includes(p.color)?'Glacier Blue':p.color,p.edition||'Standard'].join('|');return p.variant_key||[categoryOf(p),p.store,p.url].join('|');}
// Comparison can accept omitted facts for the same article; observations still use
// the exact stored variant key so a changed configuration cannot inherit a price.
function comparisonFacts(p:Product){
 const title=norm(hardwareTitle(p.full_title||p.model)),key=p.variant_key?.includes('|sku:')?p.variant_key.split('|'):[];
 const hardware=['mac','ipad'].includes(categoryOf(p))?hardwareFilters(p):null;
 const facts:Record<string,string>={family:hardware?hardware.deviceClass.toUpperCase():selectionModel(p).replace(/\s+M[1-9](?:\s+(?:Pro|Max|Ultra))?$/i,'').toUpperCase(),screen:hardware&&hardware.screen!=='Не указана'?hardware.screen:'',storage:p.storage==='—'?'':p.storage,ram:hardwareRam(p),finish:/nano.?texture|нанотекстур/i.test(title)?'nano':/standard glass|стандартне скло/i.test(title)?'standard':'',chip:hardware&&hardware.generation!=='Не указан'?[hardware.generation,hardware.tier==='Базовый'?'':hardware.tier].filter(Boolean).join(' ').toUpperCase():/\b[MA]\d+(?:\s+(?:Pro|Max|Ultra))?\b/i.exec(title)?.[0]?.toUpperCase()||key[3]||'',color:equipmentColor(p).toUpperCase(),edition:p.edition||'Standard',network:/cellular|celular|\bLTE\b|\b[345]G\b/i.test(title)?'cellular':/wi[ -]?fi/i.test(title)?'wifi':categoryOf(p)==='watch'&&/\bGPS\b/i.test(title)?'gps':key[4]||'',band:/\b[SM]\/[ML]\b/i.exec(title)?.[0]||key[5]||'',watchSize:categoryOf(p)==='watch'?(/\b\d{2}\s*mm\b/i.exec(title)?.[0]?.replace(/\s/g,'')||key[7]||''):'',connector:categoryOf(p)==='airpods'?(/USB[ -]?C/i.test(title)?'usb-c':/Lightning/i.test(title)?'lightning':key[8]||''):''};
 for(const m of title.matchAll(/(\d+)[\s-]*(?:C|cores?)?[\s-]*(CPU|GPU)\b/ig))facts[m[2].toUpperCase()]=m[1];
 for(const m of (key[6]||'').matchAll(/(CPU|GPU)(\d+)/g))facts[m[1]]||=m[2];
 return facts;
}
const comparisonCache=new WeakMap<Product,Record<string,string>>();
const manufacturerArticle=(p:Product)=>(p.sku||appleSku(p.full_title||p.model))?.toUpperCase();
// Standard five-character Apple articles share hardware across regional suffixes.
// Custom Z articles stay exact: their suffix can encode a custom configuration.
export const comparisonArticle=(p:Product)=>manufacturerArticle(p)?.replace(/^(M[A-Z0-9]{4})[A-Z0-9]{2}\/A$/,'$1');
// A few retailers omit Apple articles on Watch cards. Accept only fully named
// Sport Band and Ocean Band configurations; sparse titles stay separate.
function watchFacts(p:Product){
 if(categoryOf(p)!=='watch')return null;
 const title=hardwareTitle(p.full_title||p.model),colors='Natural Titanium|Translucent Gray|Light Blush|Navy Blue|Light Gold|Dark Bronze|Space Gray|Jet Black|Rose Gold|Starlight|Midnight|Black|Silver|White|Sand|Olive|Blue|Pink|Orange|Green';
 const band=new RegExp('('+colors+')\\s+(Sport Band|S\\. Band|Ocean Band)','i').exec(title),size=/\b(\d{2})\s*mm\b/i.exec(title)?.[1],fit=/\b[SM]\/[ML]\b/i.exec(title)?.[0]||(band?.[2].toLowerCase()==='ocean band'?'unspecified':'');
 if(!band||!size||!fit||!/\bGPS\b/i.test(title))return null;
 const withoutBand=title.replace(band[0],''),color=new RegExp('\\b('+colors+')\\b','i').exec(withoutBand)?.[1],model=selectionModel(p);
 if(!color||!/^Watch (?:Series \d+|SE \d+|Ultra \d+)$/i.test(model))return null;
 const material=/alum(?:inium|inum)?\b/i.test(title)?'aluminium':/titanium/i.test(title)?'titanium':/stainless steel/i.test(title)?'steel':'';
 return {key:[model,size,fit,color,band[1],/cellular|eSIM|\bLTE\b|\b[345]G\b/i.test(title)?'cellular':'gps',band[2].toLowerCase()==='ocean band'?'ocean':'sport'].join('|').toUpperCase(),material};
}
export function comparisonCompatible(a:Product,b:Product){
 if(categoryOf(a)!==categoryOf(b))return false;
 if(a.stock_id||b.stock_id)return !!a.stock_id&&a.stock_id===b.stock_id&&a.edition===b.edition;
 if(categoryOf(a)==='iphone')return variantKey(a)===variantKey(b);
 const articleA=comparisonArticle(a),articleB=comparisonArticle(b);
 if(!articleA||!articleB){const x=watchFacts(a),y=watchFacts(b);return !!x&&!!y&&x.key===y.key&&(!x.material||!y.material||x.material===y.material)||variantKey(a)===variantKey(b)&&(a.full_title||a.model)===(b.full_title||b.model);}
 if(articleA!==articleB)return false;
 const facts=(p:Product)=>{let f=comparisonCache.get(p);if(!f){f=comparisonFacts(p);comparisonCache.set(p,f);}return f;},x=facts(a),y=facts(b);
 return Object.keys(x).every(k=>!x[k]||!y[k]||x[k]===y[k]);
}
export function comparisonGroups(products:Product[]){
 const buckets=new Map<string,Product[][]>();
 for(const p of products){const id=categoryOf(p)==='iphone'?variantKey(p):categoryOf(p)==='watch'?'watch|'+selectionModel(p):comparisonArticle(p)?categoryOf(p)+'|sku:'+comparisonArticle(p):variantKey(p);const groups=buckets.get(id)||[];
 // Require agreement with every offer, so a sparse record cannot bridge conflicts.
 const group=groups.find(g=>g.every(other=>comparisonCompatible(p,other)));
 if(group)group.push(p);else groups.push([p]);buckets.set(id,groups);
 }
 return [...buckets.values()].flat();
}
const aliases:Record<AppleCategory,string>={iphone:'телефон айфон смартфон',ipad:'планшет айпад',mac:'ноутбук макбук компьютер imac',watch:'часы годинник вотч',airpods:'наушники навушники аирподс эйрподс',other:'колонка приставка трекер стилус'};
const searchCache=new WeakMap<Product,string>();
export function searchText(p:Product){const cached=searchCache.get(p);if(cached)return cached;const value=norm([aliases[categoryOf(p)],categoryLabels[categoryOf(p)],p.model,p.full_title,p.sku,p.storage,p.color,p.store].join(' ')).toLocaleLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu,' ');searchCache.set(p,value);return value;}
export function searchTokens(query:string){return norm(query).toLocaleLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]+/gu,' ').trim().split(/\s+/).filter(Boolean);}
export function groupedApple(products:Product[],category:AppleCategory|'all',query:string,store='',available=false){
 const tokens=searchTokens(query),eligible=products.filter(p=>(category==='all'||categoryOf(p)===category)&&(!store||p.store===store)&&(!available||['ok','preorder'].includes(p.status)));
 return comparisonGroups(eligible).filter(offers=>offers.some(p=>tokens.every(t=>searchText(p).includes(t)))).map(offers=>{const p=offers[0];return {key:variantKey(p)+'|'+p.store+'|'+p.url,title:categoryOf(p)==='iphone'?`iPhone ${p.model} · ${p.storage} · ${p.color}${p.sim==='esim'?' · eSIM':p.sim==='physical'?' · SIM':''}`:p.full_title||p.model,category:categoryOf(p),offers};});
}

export function observationKeyMatches(a:Product,b:Product){
 const legacy=!manufacturerArticle(a)?a:!manufacturerArticle(b)?b:null,fresh=legacy===a?b:a;
 if(legacy&&manufacturerArticle(fresh)&&categoryOf(a)!=='iphone'&&categoryOf(a)===categoryOf(b)&&a.store===b.store&&a.url===b.url&&(a.full_title||a.model)===(b.full_title||b.model)){
  const prefix=categoryOf(legacy)+'|url:'+legacy.store+'|'+legacy.url;
  if(legacy.variant_key===prefix||legacy.variant_key?.startsWith(prefix+'|'))return true;
 }
 return variantKey(a)===variantKey(b)||(manufacturerArticle(a)===manufacturerArticle(b)&&categoryOf(a)!=='iphone'&&categoryOf(b)!=='iphone'&&(a.full_title||a.model)===(b.full_title||b.model)&&comparisonCompatible(a,b));
}
