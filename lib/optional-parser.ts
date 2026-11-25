import {appleCategory} from './apple-products.ts';
import {parseApplePage,discoverApple} from './apple-parser.ts';
import {structuredData} from './structured-product.ts';
import {load} from 'cheerio/slim';
import {canonicalColor,type Product} from './catalog.ts';
import {norm,isNew,modelOf,memory,simOf,colorOf,priceText} from './product-facts.ts';
import {safeStoreUrl as safeUrl} from './stores.ts';
import {currentModel,type Inventory} from './inventory.ts';
const phoneTitle=(v:string)=>/^(?:(?:Смартфон|Мобільний телефон|Мобильный телефон)\s+)?(?:Apple\s+)?iPhone\s+/i.test(v);
function pageKey(url:string){return new URL(url).pathname.replace(/^\/(ua|uk|ru)\//,'/').replace(/\/$/,'');}
function availability(v:string){return /^(В наявності|В наличии|Є в наявності|InStock)$/i.test(norm(v))?'ok':/Передзамовлення|Під замовлення|Предзаказ|PreOrder|BackOrder/i.test(v)?'preorder':/Немає|Нема на|Нет в|закінчився|Недоступ|OutOfStock|Discontinued|SoldOut/i.test(v)?'unavailable':null;}
export function parseOptionalPage(store:string,html:string,url:string,scope:Inventory,options:{discovery?:boolean}={}){
 const page=load(html);if(scope==='new'&&appleCategory(norm(page('h1').first().text()))&&appleCategory(norm(page('h1').first().text()))!=='iphone')return parseApplePage(store,page,url,options);
 const selectedColor=(v:string)=>colorOf(store==='YA'?v.replace(/\s+NOW$/i,''):v);
 const $=page,title=norm($('h1').first().text()),model=modelOf(title),storage=memory(title),color=selectedColor(title),stamp=new Date().toISOString();
 const data=structuredData($);const product=data.find(d=>(d['@type']==='Product'||Array.isArray(d['@type'])&&d['@type'].includes('Product'))&&isNew(norm(d.name))&&modelOf(norm(d.name))===model&&memory(norm(d.name))===storage&&selectedColor(norm(d.name))===color);
 const offer=product?.offers&&!Array.isArray(product.offers)&&product.offers['@type']!=='AggregateOffer'?product.offers:null;
 const base=$('base[href]').attr('href');let documentBase=url;try{if(base)documentBase=safeUrl(base,store,url);}catch{}
 const resolve=(raw:string)=>safeUrl(raw,store,documentBase);
 let same=false;try{same=!!offer&&pageKey(resolve(offer.url||product.url||product['@id']))===pageKey(url);}catch{}
 const attrs:Record<string,string>={};
 if(store==='YA')$('[class*="_propertiesItem"]').each((_,e)=>{attrs[norm($(e).find('[class*="_propertyName"]').text())]=norm($(e).find('[class*="_propertyValue"]').text());});
 if(store==='Comfy')$('tr.ftr-item').each((_,e)=>{attrs[norm($(e).find('.ftr-item__name').text())]=norm($(e).find('.ftr-item__value').text());});
 if(store==='Foxtrot')$('[itemprop="additionalProperty"]').each((_,e)=>{attrs[norm($(e).find('[itemprop="name"]').first().text())]=norm($(e).find('[itemprop="value"]').text());});
 if(store==='Foxtrot')$('.pdp-main-properties-row').each((_,e)=>{attrs[norm($(e).find('.pdp-main-properties-name').text())]=norm($(e).children('.pdp-main-properties').text());});
 const specSim=simOf(Object.entries(attrs).filter(([key])=>/SIM/i.test(key)&&!/Підтримка|Поддержка/i.test(key)).map(([,value])=>value).join(' '));
 const activeSim=store==='YA'?simOf($('[aria-current="true"]').toArray().map(e=>norm($(e).text())).find(t=>/SIM/i.test(t))||''):null;
 const explicit=simOf(title),sim=activeSim||specSim||explicit||'unknown';
 const memoryEntry=Object.entries(attrs).find(([key])=>/Вбудована пам|Встроенная пам/i.test(key));
 const specMemory=memoryEntry?(memory(memoryEntry[1])||memory(memoryEntry[1]+' '+(/(?:GB|TB|ГБ|ТБ)/i.exec(memoryEntry[0])?.[0]||''))):null;
 let valid=phoneTitle(title)&&scope==='new'&&!!model&&currentModel(model)&&!!storage&&!!color&&isNew(title)&&!!product&&same&&offer?.priceCurrency==='UAH'&&(!offer.itemCondition||String(offer.itemCondition).endsWith('/NewCondition'))&&(!product.itemCondition||String(product.itemCondition).endsWith('/NewCondition'))&&(!attrs['Стан']||/^новий$/i.test(attrs['Стан']))&&(!attrs['Стан товару']||/^новий$/i.test(attrs['Стан товару']));
 if(memoryEntry&&specMemory!==storage)valid=false;
 if(activeSim&&specSim&&activeSim!==specSim||explicit&&explicit!==sim)valid=false;
 let found:string|null=null,visibleStatus:string|null=null;
 const selector=store==='YA'?'[class*="_prices"] > [class*="_price"]:not([class*="_priceOld"]),[class*="_priceValue"]':store==='Comfy'?'.product-price-block .price__current,.price-block .price__current':'[itemtype$="/Product"] [itemprop="offers"] [itemprop="price"],.product-box__main-price,.product-box__main_price,.product-box-main_price,.pdp-buy-main-price';
 const values=new Set<string>();$(selector).each((_,e)=>{const v=priceText(norm($(e).attr('content')||$(e).text())+(($(e).attr('content')&&store==='Foxtrot')?' UAH':''));if(v)values.add(v);});if(values.size===1)found=[...values][0];
 const statusSelector=store==='YA'?'[class*="_availability"]':store==='Comfy'?'.product-availability__label':'[itemtype$="/Product"] [itemprop="availability"]';
 const statuses=new Set($(statusSelector).toArray().map(e=>availability(norm($(e).attr('href')?.split('/').pop()||$(e).text()))).filter(Boolean));if(statuses.size===1)visibleStatus=[...statuses][0]!;
 const schemaStatus=availability(String(offer?.availability||'').split('/').pop()||'');let status=visibleStatus||schemaStatus||'error';
 if(visibleStatus&&schemaStatus&&visibleStatus!==schemaStatus)status='error';
 const unpriced=valid&&store==='Comfy'&&!found&&(offer.price==null||Number(offer.price)===0)&&schemaStatus==='preorder'&&$('.price-block__remain-avail-text').toArray().some(e=>norm($(e).text())==='Скоро у продажу');let price=valid&&found&&Number(found)===Number(offer.price)?found:null;if(unpriced)status='unpriced';else if(!price)status='error';
 const skuInTitle=/\(([A-Z0-9]{5,12}(?:\/[A-Z])?)\)/.exec(title)?.[1];
 const record:Product|null=valid?{store,url,model:model!,storage:storage!,color:canonicalColor(model!,color!),sim,edition:'Standard',price,status,checked_at:stamp,last_success_at:price?stamp:null,sku:skuInTitle||String(product.sku||product.mpn||'')||null,full_title:title}:null;
 if(options.discovery===false)return {parser_revision:'2026-10-16-apple-fast',record,ignored:!!title&&(!isNew(title)||!!model&&!currentModel(model)||scope==='used'),urls:[],variants:[],categories:[],next:null,catalogPage:false};
 const urls=new Set<string>(),variants=new Set<string>(),categories=new Set<string>();
 const productPath=(u:string)=>store==='YA'?new URL(u).pathname.startsWith('/product/'):store==='Comfy'?/\/smartfon-[^/]+\.html$/.test(new URL(u).pathname):/\/shop\/smartfoniy-i-mobilniye-telefoniy-/.test(new URL(u).pathname);
 $('a[href]').each((_,e)=>{try{const u=resolve($(e).attr('href')!),text=norm($(e).attr('title')||$(e).text()),m=modelOf(text),path=new URL(u).pathname;if(productPath(u)&&phoneTitle(text)&&m&&memory(text)&&currentModel(m)&&isNew(text))urls.add(u);
  const branch=store==='YA'?path.startsWith('/smartfony/apple/'):store==='Comfy'?path.startsWith('/ua/smartfon/')&&path.includes('seriya_smartphone__apple-iphone-'):path.startsWith('/uk/shop/mobilnye_telefony_apple-iphone');
  if(branch&&m&&currentModel(m)&&isNew(text)&&!new URL(u).search)categories.add(u);
 }catch{}});
 const variantsSelector=store==='YA'?'a[class*="_tab"][href],a[class*="_colorItem"][href]':store==='Comfy'?'a.info-alternatives-item[href]':'[itemtype$="/Product"] a[href]';
 if(record)$(variantsSelector).each((_,e)=>{try{const u=resolve($(e).attr('href')!);if(productPath(u)&&!/bv-|used|refurb|vidnovlen|ucenen/i.test(u))variants.add(u);}catch{}});
 const parameter=store==='Comfy'?'p':'page',current=store==='YA'?Number(/\/page_(\d+)\//.exec(url)?.[1]||1):Number(new URL(url).searchParams.get(parameter)||1);let next:string|null=null;
 $('a[href]').each((_,e)=>{try{const u=resolve($(e).attr('href')!);if(store==='YA'){if(pageKey(u).replace(/\/page_\d+$/,'')===pageKey(url).replace(/\/page_\d+$/,'')&&Number(/\/page_(\d+)\//.exec(u)?.[1])===current+1)next=u;}else if(pageKey(u)===pageKey(url)&&Number(new URL(u).searchParams.get(parameter))===current+1)next=u;}catch{}});
 const apple=scope==='new'?discoverApple(store,$,url):null;
 return {parser_revision:'2026-10-16-apple-v1',record,ignored:!!title&&(!isNew(title)||!!model&&!currentModel(model)||scope==='used'),urls:[...new Set([...urls,...(apple?.urls||[])])],variants:[...variants],categories:[...new Set([...categories,...(apple?.categories||[])])],next:next||apple?.next||null,catalogPage:urls.size>0||categories.size>0||!!apple?.catalogPage};
}
