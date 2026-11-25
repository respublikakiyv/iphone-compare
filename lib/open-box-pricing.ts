import {hasPrice,preferPrice,type Product} from './catalog.ts';
import {comparisonArticle,comparisonCompatible} from './apple-products.ts';
const article=(p:Product)=>{const value=comparisonArticle(p);return value&&/^[MZ][A-Z0-9]{4,11}(?:\/[A-Z])?$/.test(value)?value:null;};
// Only the same Apple article/configuration at iPeople is a price reference.
export function priceOpenBoxes(products:Product[],rate:unknown,rateAt?:string|null):Product[]{
 const exchange=Number(rate),validRate=Number.isFinite(exchange)&&exchange>=1&&exchange<=1000,index=new Map<string,Product[]>();
 for(const p of products){const sku=article(p);if(p.store==='iPeople'&&(p.edition||'Standard')==='Standard'&&!p.stock_id&&hasPrice(p)&&sku){const group=index.get(sku)||[];group.push(p);index.set(sku,group);}}
 return products.map<Product>(p=>{
  if(p.edition!=='OpenBox')return p;
  const sku=article(p),standard={...p,stock_id:undefined,edition:'Standard'},candidates=sku?(index.get(sku)||[]).filter(n=>comparisonCompatible(standard,n)):[],base=candidates.reduce<Product|undefined>((best,n)=>preferPrice(n,best)?n:best,undefined),value=validRate&&base?Math.round((Number(base.price)-100*exchange)*100)/100:null;
  if(!base||value===null||value<100)return {...p,price:null,status:'unpriced',last_success_at:null,metadata_notice:!validRate?'Для расчёта Open Box укажите курс доллара.':base?'Цена нового меньше скидки $100.':'Нет цены нового iPeople для точной комплектации.'};
  const dates=[base.last_success_at||base.checked_at,rateAt].filter((s):s is string=>!!s&&Number.isFinite(Date.parse(s))&&Date.parse(s)<=Date.now()+300000).sort((a,b)=>Date.parse(b)-Date.parse(a)),at=dates[0]||p.checked_at;
  return {...p,price:String(value),status:'ok',last_success_at:at,checked_at:at,metadata_notice:'Новое iPeople '+Number(base.price).toLocaleString('ru-RU')+' ₴ − $100 × '+exchange+' ₴',price_rule:'new-minus-100-usd'};
 });
}
