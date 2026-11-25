import {ispaceCatalogPrices} from './ispace-catalog-prices.ts';
import {iPeopleNoOffer} from './ipeople-availability.ts';
import {appleCategory} from './apple-products.ts';
import {parseApplePage,discoverApple} from './apple-parser.ts';
import {structuredData,schemaType} from './structured-product.ts';
import {decodeNuxtProduct} from './ispace-data.ts';
import {load} from 'cheerio/slim';
import {canonicalColor,type Product} from './catalog.ts';
import {currentModel,isUsedAir,usedSimAllowed,type Inventory} from './inventory.ts';
export {storeHosts as hosts} from './stores.ts';
import {safeStoreUrl as safeUrl} from './stores.ts';
export {safeUrl};
import {norm,isUsed,isNew,modelOf,memory,simOf,palette,colorOf,priceText} from './product-facts.ts';
import {parseOptionalPage} from './optional-parser.ts';
function swatch(value:string){const data=JSON.parse(value||'{}');for(const k of Object.keys(data))if(typeof data[k]==='string')data[k]=data[k].replace(/\\u([0-9a-fA-F]{4})/g,(_:string,h:string)=>String.fromCharCode(parseInt(h,16))).replace(/\\\//g,'/');return data;}
export function parsePage(store:string,html:string,url:string,scope:Inventory='new',options:{discovery?:boolean}={}){
 url=safeUrl(url,store);if(['YA','Foxtrot','Comfy'].includes(store))return parseOptionalPage(store,html,url,scope,options);const used=scope==='used';
 const $=load(html);const missingPage='Помилка 404: сторінка не знайдена';if(store==='iPeople'&&new URL(url).pathname.startsWith('/products/')&&norm($('h1').first().text())===missingPage&&norm($('title').text())===missingPage&&!$('#product').length)return {parser_revision:'2026-10-17-soft-404',gone:true,record:null,ignored:false,urls:[],variants:[],categories:[],next:null,catalogPage:false};if(scope==='new'&&appleCategory(norm($('h1').first().text()))&&appleCategory(norm($('h1').first().text()))!=='iphone')return parseApplePage(store,$,url,options);const title=norm($(store==='Jabko'?'h1.product-info__title':'h1').first().text());const model=modelOf(title),storage=memory(title);const stamp=new Date().toISOString();
 let absentPrice=false;let sim:string|null=null,color=colorOf(title),price:string|null=null,status='error',valid=(used?store==='iPeople'&&isUsed(title):isNew(title))&&!!model&&!!storage;
 const schema=structuredData($);
 let sku:string|null=null;for(const m of title.matchAll(/\(([^)]*)(?:\)|$)/g))if(/^[A-Z0-9]{5,12}(?:\/[A-Z])?(?:\s*[,/|]\s*[A-Z0-9]{5,12}(?:\/[A-Z])?)*$/.test(m[1]))sku=m[1];
 for(const d of schema.filter(d=>schemaType(d,'Product')&&norm(d.name)===title)){for(const k of ['model','sku'])if(/^[A-Z0-9]{5,12}(?:\/[A-Z])?$/.test(String(d[k]||''))&&/[A-Z]/.test(d[k])){if(!sku||sku===d[k])sku=d[k];break;}}
 const uniquePrice=(selector:string)=>{const p=new Set($(selector).toArray().map(e=>priceText($(e).text())).filter(Boolean));return p.size===1?[...p][0]!:null;};
 if(store==='iPeople'){
  const attrs:Record<string,string>={};$('.sc-product-content-attributes-list-item').each((_,e)=>{const cells=$(e).children('div');if(cells.length===2)attrs[norm(cells.eq(0).text())]=norm(cells.eq(1).text());});
  sim=simOf(attrs['Кількість SIM-карт']||attrs['Тип SIM-карти']||'');const ac=colorOf(attrs['Колір']||'');if(color&&ac&&color!==ac&&canonicalColor(model||'',color)!==canonicalColor(model||'',ac)&&!color.toLowerCase().split(' ').includes(ac.toLowerCase()))valid=false;color=color||ac;
  const stickers=$('.sc-module-sticker').toArray().map(e=>norm($(e).text()));const available=$('.sc-module-sticker-green').toArray().some(e=>norm($(e).text())==='В наявності');const preorder=stickers.some(v=>['Під замовлення','Передзамовлення'].includes(v)||/^Очікується через \d+(?:[-–]\d+)? дн(?:і|ів)$/.test(v));const absent=stickers.some(v=>['Немає в наявності','Немає в наявностi','Нет в наличии','Немає на складі','Під замовлення','Передзамовлення','Очікується','Скоро у продажу','Незабаром у продажу'].includes(v));
  const found=uniquePrice('.sc-module-price.uah');if(found&&(available||preorder||absent)){price=found;status=available?'ok':preorder?'preorder':'unavailable';}else status=absent?'unavailable':'error';const noOffer=!price&&iPeopleNoOffer($,schema.find(d=>schemaType(d,'Product')&&norm(d.name)===title));if(noOffer)status=noOffer;
 }else if(store==='Jabko'){
  const active=$('a.crosslink.activ[data-label]').toArray();const labels=active.map(e=>$(e).attr('data-label'));const condition=$('a.crosslink[data-label]').toArray().map(e=>$(e).attr('data-label')).filter(v=>['Новий','Як Новий','Б/У'].includes(v||''));
  valid=valid&&!labels.includes('Ultra');
  if(condition.length)valid=valid&&labels.includes('Новий')&&!labels.some(v=>['Як Новий','Ultra','Б/У'].includes(v||''));
  else{const p=schema.find(d=>schemaType(d,'Product')&&norm(d.name)===title);const b=schema.find(d=>schemaType(d,'BreadcrumbList'));const entries=b?.itemListElement||[];const c=p?.itemCondition||p?.offers?.itemCondition||'';const schemaNew=(p?.additionalProperty||[]).some((v:any)=>norm(v.name)==='Стан товару'&&norm(v.value)==='Новий'),standard=(p?.additionalProperty||[]).some((v:any)=>norm(v.name)==='Версія'&&norm(v.value)==='Standard');
   let exactNew=false;try{exactNew=schemaNew&&standard&&safeUrl(p?.url||'',store,url)===url;}catch{}
   valid=valid&&!!p&&(!c||String(c).endsWith('/NewCondition'))&&entries.some((v:any)=>String(v.item||'').startsWith('https://jabko.ua/iphone/apple-iphone-')||exactNew&&v.item==='https://jabko.ua/iphone/')&&!entries.some((v:any)=>!isNew(String(v.name||'')));}
  const selected=active.filter(e=>['Фізична SIM','eSIM'].includes($(e).attr('data-label')||''));
  if(!selected.length&&!$('a.crosslink[data-label="Фізична SIM"],a.crosslink[data-label="eSIM"]').length){
   const specs:Record<string,string>={};$('.attribute-group-one').each((_,e)=>{specs[norm($(e).find('.attribute-name').first().text())]=norm($(e).find('.attribute-text').first().text());});
   const explicit=simOf(title),confirmed=simOf(specs['Формат SIM-карти']||specs['Кількість SIM-карт']||'');
   if(explicit&&explicit===confirmed){
    // Some eSIM-only products select memory instead of a SIM tab. Accept only
    // an active swatch for this exact title and URL, with agreement in specs.
    const matches=active.filter(e=>{try{return norm(swatch($(e).attr('data-swatch')||'{}').name)===title&&safeUrl($(e).attr('href')||'',store,url)===url;}catch{return false;}});
    const payloads=new Set(matches.map(e=>$(e).attr('data-swatch')));if(matches.length&&payloads.size===1)selected.push(matches[0]);sim=explicit;
   }
  }
  if(selected.length!==1)valid=false;
  if(selected.length===1){const a=$(selected[0]);sim=sim||(a.attr('data-label')==='Фізична SIM'?'physical':'esim');let sw:any={};try{sw=swatch(a.attr('data-swatch')||'{}');}catch{valid=false;}
   if(norm(sw.name)!==title)valid=false;const allowed=new Set([new URL(url).pathname.replace(/\/$/,'')]);try{const c=$('link[rel="canonical"]').attr('href');if(c)allowed.add(new URL(safeUrl(c,store,url)).pathname.replace(/\/$/,''));}catch{}
   let same=false;try{same=allowed.has(new URL(safeUrl(a.attr('href')||'',store,url)).pathname.replace(/\/$/,''));}catch{}
   const available=['В наявності','Залишилось мало','Є в наявності'].includes(norm(sw.stock_status_name));
   const preorder=['Передзамовлення','Під замовлення','Предзаказ','Под заказ'].includes(norm(sw.stock_status_name))||/^Доставка \d+(?:\s*[-–]\s*\d+)? (?:день|дні|днів|тиждень|тижні|тижнів)$/i.test(norm(sw.stock_status_name));
   const unavailable=['Немає в наявності','Немає на складі','Нет в наличии'].includes(norm(sw.stock_status_name));
   const found=uniquePrice('.product-info__price-new .price-new__uah');if(found&&same&&priceText(String(sw.price_uah||''))===found&&(available||preorder||unavailable)){price=found;status=available?'ok':preorder?'preorder':'unavailable';}else status=unavailable?'unavailable':'error';
   if(same&&preorder&&!found&&typeof sw.price_uah_no_currency==='number'&&sw.price_uah_no_currency===0&&$('.product-info__price-new .price-new__uah').toArray().every(e=>!/[0-9]/.test($(e).text())))status='unpriced';
   if(!sku&&/^[A-Z0-9]{5,12}(?:\/[A-Z])?$/.test(String(sw.model||'')))sku=sw.model;
  }
 }
 if(store==='iSpace'){
  const p=decodeNuxtProduct($('#__NUXT_DATA__').text(),new URL(url).pathname.split('/').pop()||'');
  const ld=schema.find(d=>schemaType(d,'Product')&&norm(d.name)===title);
  const features=(p?.featureGroups||[]).flatMap((g:any)=>g.features||[]);
  const attr=(id:string)=>norm(features.find((f:any)=>f.externalCfId===id)?.value);
  const simFeatures=features.filter((f:any)=>/SIM/i.test(f.name+' '+f.externalCfId)).map((f:any)=>f.value).join(' ');
  sim=simOf(simFeatures)||simOf(title)||'unknown';
  const actual=uniquePrice('.pdp-product-price_final,.product-page_prices .product-price_price-value');
  let same=false;try{same=!!ld&&safeUrl(ld.offers?.url||ld['@id'],store,url)===safeUrl(url,store);}catch{}
  valid=valid&&!!p&&p.name===title&&p.slug===new URL(url).pathname.split('/').pop()&&p.condition===1&&same&&ld.sku===p.sku&&p.currency==='UAH'&&ld.offers?.priceCurrency==='UAH'&&memory(attr('INTERNAL_MEMORY_SIZE'))===storage&&(palette(attr('EXTERNAL_COLOR'))===color||!!palette(attr('EXTERNAL_COLOR'))&&!!color?.toLowerCase().split(' ').includes(palette(attr('EXTERNAL_COLOR'))!.toLowerCase()));
  sku=p?.sku||sku;
  absentPrice=!!p&&p.availableAction==='coming_soon'&&p.finalPrice===null&&!actual;
  valid=valid&&!absentPrice;
  const actions:Record<string,string>={coming_soon:'unavailable',preorder:'preorder',force_preorder:'preorder',buy:'ok',addToCart:'ok',add_to_cart:'ok',unavailable:'unavailable',notify:'unavailable',notify_me:'unavailable'};
  status=actions[p?.availableAction]||'error';
  if(valid&&actual&&Number(actual)===Number(p.finalPrice)&&[Number(p.price),Number(p.finalPrice)].includes(Number(ld.offers?.price)))price=actual;else status='error';
 }
 if(simOf(title)==='esim'&&sim==='physical')valid=false;
 if(used&&isUsedAir(model||'')&&!sim)sim='esim';
 if(used&&!usedSimAllowed(model||'',sim||''))valid=false;
 const record:Product|null=valid&&color&&sim&&model&&storage?{store,url,model,storage,sim,color:canonicalColor(model,color),edition:used?'Used':'Standard',price,status,checked_at:stamp,last_success_at:price?stamp:null,full_title:title,sku}:null;
 if(options.discovery===false)return {parser_revision:'2026-10-16-apple-fast',record,ignored:absentPrice||!!title&&(used?(store!=='iPeople'||!isUsed(title)||!isUsedAir(model||'')&&(sim==='esim'||simOf(title)==='esim')):!isNew(title)||(!!model&&!currentModel(model))),urls:[],variants:[],categories:[],next:null,catalogPage:false};
 const urls=new Set<string>();const add=(v:string)=>{try{urls.add(safeUrl(v,store,url));}catch{}};
 const selector=store==='iPeople'?'a.sc-module-title[href]':store==='iSpace'?'a.entity-card_name[href],a.entity-card_title[href],a[href^="/product/"]':'a.catalog-product-item--title[href]';const anchors=$(selector);anchors.each((_,e)=>{const t=norm($(e).text());if(modelOf(t)&&memory(t)&&(used?store==='iPeople'&&isUsed(t)&&(isUsedAir(modelOf(t)||'')||simOf(t)!=='esim'):isNew(t)&&currentModel(modelOf(t)!)))add($(e).attr('href')!);});
 const variants:string[]=[];if(store==='Jabko')$('a.crosslink[data-label][href]').each((_,e)=>{try{if(['Ultra','Б/У','Як Новий'].includes($(e).attr('data-label')||''))return;const sw=swatch($(e).attr('data-swatch')||'{}'),model=modelOf(norm(sw.name));if(model&&memory(norm(sw.name))&&currentModel(model)&&isNew(norm(sw.name)))variants.push(safeUrl($(e).attr('href')!,store,url));}catch{}});
 if(store==='iSpace')$('a.product-color-list_color-wrapper[href],a.product-attributes-options_item[href]').each((_,e)=>{try{const v=safeUrl($(e).attr('href')!,store,url);if(new URL(v).pathname.startsWith('/product/'))variants.push(v);}catch{}});
 const categories=new Set<string>();$('a[href]').each((_,e)=>{try{const u=safeUrl($(e).attr('href')!,store,url),path=new URL(u).pathname;const model=modelOf(norm($(e).text()));const branch=used?store==='iPeople'&&path.startsWith('/b-u-tekhnyka-ua/b-u-iphone-ua/b-u-iphone-'):store==='iSpace'?path.startsWith('/category/iphone'):store==='Jabko'?path.startsWith('/iphone/apple-iphone-'):path.startsWith('/apple-ua/iphone/');if(branch&&model&&(used||currentModel(model))&&!new URL(u).search)categories.add(u);}catch{}});
 const current=Number(new URL(url).searchParams.get('page')||1);let next:string|null=null;$(store==='iSpace'?'a[href]':'.pagination a[href]').each((_,e)=>{try{const u=safeUrl($(e).attr('href')!,store,url);if(new URL(u).pathname.replace(/\/$/,'')===new URL(url).pathname.replace(/\/$/,'')&&Number(new URL(u).searchParams.get('page'))===current+1)next=u;}catch{}});
 const ignored=absentPrice||!!title&&(used?(store!=='iPeople'||!isUsed(title)||!isUsedAir(model||'')&&(sim==='esim'||simOf(title)==='esim')):!isNew(title)||(!!model&&!currentModel(model)));
 const apple=used?null:discoverApple(store,$,url);
 return {priceCards:store==='iSpace'?ispaceCatalogPrices($,url):[],parser_revision:'2026-10-16-apple-v1',record,ignored,urls:[...new Set([...urls,...(apple?.urls||[])])],variants:[...new Set(variants)],categories:[...new Set([...categories,...(apple?.categories||[])])],next:next||apple?.next||null,catalogPage:anchors.length>0||categories.size>0||!!apple?.catalogPage};
}
