import type {Product} from './catalog.ts';
import {appleModel,appleSku} from './apple-products.ts';
import {equipmentColor} from './product-selection.ts';
export const isOpenBox=(name:string)=>/\bopen[\s._-]*box\b|опен[\s-]*бокс|відкрит[а-яіїє]*\s+короб/iu.test(name);
export function openBoxProduct(row:any,at:string,rate?:number):Product|null{
 const title=String(row.name||''),id=row.meta?.href?.split('?')[0];if(row.archived||!isOpenBox(title+' '+(row.pathName||''))||!/(?:MacBook\s*(?:Air|Pro|Neo)|Mac\s+(?:mini|Studio|Pro)|iMac)\b/i.test(title)||!/^https:\/\/api\.moysklad\.ru\/api\/remap\/1\.2\/entity\/(product|variant)\/[a-f0-9-]{36}$/.test(id||''))return null;
 const capacities=[...title.matchAll(/(\d+)\s*(GB|TB|ГБ|ТБ)\b/igu)].map(m=>m[1]+m[2].toUpperCase().replace('ГБ','GB').replace('ТБ','TB')).sort((a,b)=>parseInt(b)*(b.includes('TB')?1024:1)-parseInt(a)*(a.includes('TB')?1024:1));
 const currency=(p:any)=>{const c=p.currency||{},text=[c.isoCode,c.code,c.name].filter(Boolean).join(' ');return /(?:\b(?:UAH|980)\b|грн|гривн)/i.test(text)?'UAH':/(?:\b(?:USD|840)\b|дол[л]?ар|dollar|\$)/i.test(text)?'USD':null;};
 const prices=(row.salePrices||[]).filter((p:any)=>p.value>0&&currency(p)),online=prices.filter((p:any)=>/^online$/i.test(p.priceType?.name||'')),retail=prices.filter((p:any)=>/роздр|рознич|розница|retail|^ц[еі]на продаж[уи]$/i.test(p.priceType?.name||'')),chosen=online.length===1?online[0]:retail.length===1?retail[0]:prices.length===1?prices[0]:null;
 const amount=chosen?chosen.value/100:null,unit=chosen?currency(chosen):null,value=amount!==null?(unit==='UAH'?amount:rate&&Number.isFinite(rate)&&rate>=1&&rate<=1000?Math.round(amount*rate):null):null;

 const p:Product={store:'iPeople',url:'https://online.moysklad.ru/app/#good/edit?id='+id.split('/').at(-1),stock_id:id,category:'mac',edition:'OpenBox',model:appleModel(title),full_title:title,sku:appleSku(title)||row.article||null,variant_key:'mac|open-box:'+id,storage:capacities[0]||'—',sim:'unknown',color:'—',price:value!==null?String(value):null,metadata_notice:amount!==null&&unit==='USD'&&value!==null?'Цена МойСклад: $'+amount+' · курс '+rate+' ₴':undefined,status:value!==null?'ok':'unpriced',checked_at:at,last_success_at:value!==null?at:null};p.color=equipmentColor(p)||'—';return p;
}
