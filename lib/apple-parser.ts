import {ispaceCatalogPrices} from './ispace-catalog-prices.ts';
import {load} from 'cheerio/slim';
import {iPeopleNoOffer} from './ipeople-availability.ts';
import {appleCategory,appleModel,appleNew,appleSku} from './apple-products.ts';
import {rootCategory} from './apple-roots.ts';
import {safeStoreUrl} from './stores.ts';
import {norm,palette,memory,plausibleApplePrice} from './product-facts.ts';
import {structuredData,schemaType} from './structured-product.ts';
import {decodeNuxtProduct} from './ispace-data.ts';
import {hardwareTitle} from './product-selection.ts';
import type {Product} from './catalog.ts';
type Document=ReturnType<typeof load>;
export function applePrice(text:string,category?:string){const values=new Set([...norm(text).matchAll(/(\d[\d\s]*(?:[.,]\d{2})?)\s*(?:грн|₴|UAH)/ig)].map(m=>Number(m[1].replace(/\s/g,'').replace(',','.'))).filter(n=>plausibleApplePrice(category,n)));return values.size===1?String([...values][0]):null;}
function statusOf(value:string){const s=norm(value).split('/').pop()||'';return /^(?:В наявності|В наличии|Є в наявності|Залишилось мало|InStock)$/i.test(s)?'ok':/^(?:Під замовлення|Передзамовлення|Предзаказ|Доставка \d+(?:\s*[-–]\s*\d+)? (?:день|дні|днів|тиждень|тижні|тижнів)|Очікується через \d+(?:[-–]\d+)? дн(?:і|ів)|PreOrder|BackOrder)$/i.test(s)?'preorder':/^(?:Немає в наявності|Немає на складі|Нет в наличии|Скоро у продажу|Незабаром у продажу|Очікується|OutOfStock|Discontinued|SoldOut)$/i.test(s)?'unavailable':null;}
function decodeSwatch(value:string){const d=JSON.parse(value);for(const k of Object.keys(d))if(typeof d[k]==='string')d[k]=d[k].replace(/\\u([0-9a-f]{4})/ig,(_:string,h:string)=>String.fromCharCode(parseInt(h,16))).replace(/\\\//g,'/');return d;}
export function discoverApple(store:string,$:Document,url:string){
 const urls=new Set<string>(),categories=new Set<string>(),variants=new Set<string>();let next:string|null=null;
 const resolve=(raw:string)=>safeStoreUrl(raw,store,url);
 const productSelector=store==='iPeople'?'a.sc-module-title[href]':store==='Jabko'?'a.catalog-product-item--title[href]':store==='iSpace'?'a.entity-card_name[href],a.entity-card_title[href]':'a[href]';
 $(productSelector).each((_,e)=>{const t=norm($(e).attr('title')||$(e).text()),category=appleCategory(t);if(category&&category!=='iphone'&&appleNew(t))try{const u=resolve($(e).attr('href')!);if(!['iPeople','Jabko','iSpace'].includes(store)&&(!/\/product\/|\.html$/.test(new URL(u).pathname)))return;if(store==='Foxtrot'&&!/\/shop\/(?:naushniki|noutbuki|planshety|smart_chasi|monobloki|kompyutery)-/.test(new URL(u).pathname))return;urls.add(u);}catch{}});
 // Some Comfy catalog responses expose cards only in public JSON-LD.
 // Use these for discovery only; verify prices on each exact product page.
 if(store==='Comfy')for(const product of structuredData($)){
  for(const offer of Array.isArray(product.Offers)?product.Offers:[]){
   if(appleCategory(offer.name)&&appleCategory(offer.name)!=='iphone'&&appleNew(offer.name))try{const u=resolve(offer.url);if(/\.html$/.test(new URL(u).pathname))urls.add(u);}catch{}
  }
 }
 $('link[rel="next"][href]').each((_,e)=>{try{const u=resolve($(e).attr('href')!),a=new URL(url),b=new URL(u),parameter=store==='Comfy'?'p':'page';if(a.pathname.replace(/\/$/,'')===b.pathname.replace(/\/$/,'')&&Number(b.searchParams.get(parameter))===Number(a.searchParams.get(parameter)||1)+1)next=u;}catch{}});
 $('a[href]').each((_,e)=>{try{const u=resolve($(e).attr('href')!),path=new URL(u).pathname,t=norm($(e).text());const c=rootCategory(store,u);if(c&&c!=='iphone'&&!new URL(u).search&&!/б.?у|open.?box|refurb|services|accessories|aksess|chehl|chohl|remesh|steklo|sklo/i.test(path)&&t&&t.length<80)categories.add(u);
 const current=new URL(url),candidate=new URL(u),parameter=store==='Comfy'?'p':'page';
 if(candidate.pathname.replace(/\/$/,'')===current.pathname.replace(/\/$/,'')&&Number(candidate.searchParams.get(parameter))===Number(current.searchParams.get(parameter)||1)+1)next=u;
 if(store==='YA'&&candidate.pathname.replace(/\/page_\d+\/?$/,'').replace(/\/$/,'')===current.pathname.replace(/\/page_\d+\/?$/,'').replace(/\/$/,'')&&Number(/\/page_(\d+)/.exec(u)?.[1])===Number(/\/page_(\d+)/.exec(url)?.[1]||1)+1)next=u;
 }catch{}});
 return {urls:[...urls],categories:[...categories],variants:[...variants],next,catalogPage:urls.size>0||!!rootCategory(store,url)&&['iSpace','iPeople','Jabko'].includes(store)&&$(productSelector).length>0};
}
export function parseApplePage(store:string,$:Document,url:string,options:{discovery?:boolean}={}){
 const title=norm($('h1').first().text()),category=appleCategory(title),discovery=options.discovery===false?{urls:[],categories:[],variants:[] as string[],next:null,catalogPage:false}:discoverApple(store,$,url);let record:Product|null=null;
 const canonicalTitle=(v:string)=>norm(v).replace(/(\d+(?:[.,]\d+)?)(?:-inch|[\"″])/ig,'$1in').replace(/^(?:Смартфон|Планшет|Ноутбук|Навушники)\s+/i,'');
 const schema=structuredData($),selected=schema.find(p=>schemaType(p,'Product')&&canonicalTitle(p.name)===canonicalTitle(title));
 const unique=(selector:string)=>{const prices=new Set($(selector).toArray().map(e=>applePrice($(e).attr('content')?$(e).attr('content')+' UAH':$(e).text(),category||undefined)).filter(Boolean));return prices.size===1?[...prices][0]!:null;};
 let verifiedNoOffer=false;let price:string|null=null,status='error',sku=appleSku(title),valid=!!category&&category!=='iphone'&&appleNew(title);
 if(store==='iPeople'){
  price=unique('.sc-module-price.uah');const statuses=new Set($('.sc-module-sticker').toArray().map(e=>statusOf($(e).text())).filter(Boolean));if(statuses.size===1)status=[...statuses][0]!;const noOffer=!price&&iPeopleNoOffer($,selected);if(noOffer){verifiedNoOffer=true;status=noOffer;}
 }else if(store==='Jabko'){
  const active=$('a.crosslink.activ[data-swatch][href]').toArray();const confirmed:any[]=[];
  for(const e of active)try{const sw=decodeSwatch($(e).attr('data-swatch')!);if(norm(sw.name)===title&&safeStoreUrl($(e).attr('href')!,store,url)===url)confirmed.push(sw);}catch{}
  const prices=new Set(confirmed.map(sw=>applePrice(String(sw.price_uah||''),category||undefined)).filter(Boolean)),statuses=new Set(confirmed.map(sw=>statusOf(sw.stock_status_name||'')).filter(Boolean));
  const conditions=$('a.crosslink[data-label]').toArray().map(e=>$(e).attr('data-label'));if(conditions.some(c=>['Новий','Б/У','Як Новий'].includes(c||''))&&!$('a.crosslink.activ[data-label="Новий"]').length)valid=false;
  price=unique('.product-info__price-new .price-new__uah');
  // Archived Jabko pages remove all crosslinks. Confirm the exact page using
  // independent visible and schema evidence instead of requiring absent controls.
  const visibleStatuses=new Set($('.product-info__flex-status').toArray().map(e=>norm($(e).text())).filter(Boolean));
  let archiveIdentity=false;try{archiveIdentity=!!selected&&safeStoreUrl(selected.url||selected.offers?.url,store,url)===url&&safeStoreUrl(selected.offers?.url,store,url)===url;}catch{}
  const archived=active.length===0&&visibleStatuses.size===1&&visibleStatuses.has('Архівний товар')&&archiveIdentity&&selected?.offers?.priceCurrency==='UAH'&&statusOf(selected?.offers?.availability||'')==='unavailable'&&(!price||Number(price)===Number(selected?.offers?.price));
  valid=valid&&!!selected&&(archived||prices.size===1&&prices.has(price)&&statuses.size===1);
  if(archived){status='unavailable';verifiedNoOffer=!price;}else if(statuses.size===1)status=[...statuses][0]!;
  const schemaArticle=appleSku('('+String(selected?.sku||'')+')'),swatchArticles=new Set(confirmed.map(sw=>appleSku('('+String(sw.model||'')+')')).filter(Boolean));
  if(schemaArticle&&swatchArticles.size&&(swatchArticles.size!==1||!swatchArticles.has(schemaArticle)))valid=false;
  // The article is often omitted from the visible AirPods name. Require agreement
  // between this exact page's Product schema and its selected option before using it.
  if(!sku&&schemaArticle&&swatchArticles.size===1&&swatchArticles.has(schemaArticle))sku=schemaArticle;
  if(sku&&selected?.sku&&sku!==String(selected.sku))valid=false;
  if(options.discovery!==false)$('a.crosslink[data-swatch][href]').each((_,e)=>{try{const sw=decodeSwatch($(e).attr('data-swatch')!),label=$(e).attr('data-label');if(!['Б/У','Як Новий'].includes(label||'')&&appleCategory(sw.name)===category&&appleNew(sw.name))discovery.variants.push(safeStoreUrl($(e).attr('href')!,store,url));}catch{}});
 }else if(store==='iSpace'){
  const slug=new URL(url).pathname.split('/').pop()!,p=decodeNuxtProduct($('#__NUXT_DATA__').text(),slug);price=unique('.pdp-product-price_final,.product-page_prices .product-price_price-value');
  let same=false;try{same=!!selected&&safeStoreUrl(selected.offers?.url||selected['@id'],store,url)===url;}catch{}
  valid=valid&&same&&!!p&&norm(p.name)===title&&p.condition===1&&p.currency==='UAH'&&!!selected&&p.sku===selected.sku&&selected.offers?.priceCurrency==='UAH'&&Number(price)===Number(p.finalPrice)&&[Number(p.price),Number(p.finalPrice)].includes(Number(selected.offers?.price));
  const actions:Record<string,string>={buy:'ok',addToCart:'ok',add_to_cart:'ok',preorder:'preorder',force_preorder:'preorder',coming_soon:'unavailable',unavailable:'unavailable',notify:'unavailable',notify_me:'unavailable'};status=actions[p?.availableAction]||'error';sku=appleSku(title)||p?.sku||null;
  if(options.discovery!==false)$('a.product-color-list_color-wrapper[href],a.product-attributes-options_item[href]').each((_,e)=>{try{discovery.variants.push(safeStoreUrl($(e).attr('href')!,store,url));}catch{}});
 }else{
  const product=selected||schema.find(p=>schemaType(p,'Product')&&appleCategory(p.name)===category&&appleModel(p.name)===appleModel(title));const offer=product?.offers;
  let same=false;try{same=safeStoreUrl(offer?.url||product?.url||product?.['@id'],store,url).replace(/\/(ua|uk|ru)\//,'/')===url.replace(/\/(ua|uk|ru)\//,'/');}catch{}
  price=unique(store==='YA'?'[class*="_prices"] > [class*="_price"]:not([class*="_priceOld"]),[class*="_priceValue"]':store==='Comfy'?'.product-price-block .price__current,.price-block .price__current':'.product-box-main_price,.pdp-buy-main-price,[itemtype$="/Product"] [itemprop="offers"] [itemprop="price"]');
  const unpriced=store==='Comfy'&&!price&&(offer?.price==null||Number(offer.price)===0)&&statusOf(offer?.availability||'')==='preorder'&&$('.price-block__remain-avail-text').toArray().some(e=>norm($(e).text())==='Скоро у продажу');valid=valid&&same&&offer?.priceCurrency==='UAH'&&!Array.isArray(offer)&&(!offer.itemCondition||String(offer.itemCondition).endsWith('/NewCondition'))&&(unpriced||Number(price)===Number(offer.price));status=unpriced?'unpriced':statusOf(offer?.availability||'')||'error';verifiedNoOffer=unpriced;
 }
 // Comfy catalog cards collapse many RAM/SSD/radio/band options into one card.
 // Follow only the selected product's option controls, never reviews or accessories.
 if(store==='Comfy'&&options.discovery!==false&&valid){
  const families:Record<string,RegExp>={mac:/^(?:noutbuk-apple-macbook|monoblok-apple-imac|komp-juter-apple-mac)/,ipad:/^planshet-apple-ipad/,watch:/^smart-godinnik-apple-watch/,airpods:/^(?:navushniki|naushniki).*apple-airpods/};
  $('.i-alt__list a.info-alternatives-item[href]').each((_,e)=>{try{
   const target=new URL(safeStoreUrl($(e).attr('href')!,store,new URL(url).origin+'/'));
   const leaf=target.pathname.split('/').pop()!;if(!families[category||'']?.test(leaf)||!leaf.endsWith('.html')||target.search)return;
   target.pathname='/ua/'+leaf;const candidate=safeStoreUrl(target.href,store,url);if(candidate!==url)discovery.variants.push(candidate);
  }catch{}});
 }
 if(!price&&!verifiedNoOffer)status='error';
 if(valid&&category){const colorCandidates=title.match(/\b(?:Space Gray|Space Grey|Space Black|Sky Blue|Rose Gold|Light Gold|Midnight|Starlight|Silver|White|Black|Blue|Pink|Purple|Gold|Green|Orange)\b/ig)||[];const color=palette(colorCandidates[0]||'')||'—';
  // Preserve exact manufacturer article and observed hardware for price identity.
  let variant_key=sku?category+'|sku:'+sku:category+'|url:'+store+'|'+url;
  const capacities=[...title.matchAll(/(\d+)\s*(GB|TB|ГБ|ТБ)(?![\p{L}\p{N}])/igu)].map(m=>memory(m[0])!).filter(Boolean).sort((a,b)=>(Number(b.replace(/\D/g,''))*(b.includes('TB')?1024:1))-(Number(a.replace(/\D/g,''))*(a.includes('TB')?1024:1)));
  const chip=/\bM[1-9](?:\s+(?:Pro|Max|Ultra))?\b/i.exec(hardwareTitle(title))?.[0]?.toUpperCase()||'';const network=/cellular|celular|\bLTE\b|\b[345]G\b/i.test(title)?'cellular':/wi[ -]?fi/i.test(title)?'wifi':'';const band=/\b[SM]\/[ML]\b/i.exec(title)?.[0]||'';const cores=[...title.matchAll(/(\d+)[\s-]*(?:C|cores?)?[\s-]*(CPU|GPU)\b/ig)].map(m=>m[2].toUpperCase()+m[1]).sort().join(',');const watchSize=category==='watch'?(/\b\d{2}\s*mm\b/i.exec(title)?.[0]?.replace(/\s/g,'')||''):'';const connector=category==='airpods'?(/USB[ -]?C/i.test(title)?'usb-c':/Lightning/i.test(title)?'lightning':''):'';variant_key+='|'+[...new Set(capacities)].join(',')+'|'+chip+'|'+network+'|'+band+'|'+cores+'|'+watchSize+'|'+connector;
  record={store,url,category,variant_key,model:appleModel(title),storage:capacities[0]||'—',sim:'unknown',color,edition:'Standard',sku,full_title:title,price,status,checked_at:new Date().toISOString(),last_success_at:price?new Date().toISOString():null};
 }
 return {priceCards:store==='iSpace'&&options.discovery!==false?ispaceCatalogPrices($,url):[],parser_revision:'2026-10-29-apple-price-floor-v2',record,ignored:!!category&&!appleNew(title),...discovery,variants:[...new Set(discovery.variants)]};
}
