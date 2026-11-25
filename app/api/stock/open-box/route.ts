import {cloudCatalog} from '../../../../lib/cloud-refresh';
import {priceOpenBoxes} from '../../../../lib/open-box-pricing';
import type {Product} from '../../../../lib/catalog';
import {priceHistoryStatements} from '../../../../lib/price-history';
import {env} from 'cloudflare:workers';
import {visitor,json,failure,db} from '../../../../lib/auth';
import {stockRequest} from '../../../../lib/moysklad';
import {withManualStockUpdate,stockIntegrationPaused} from '../../../../lib/stock-integration';
import {stockSnapshot,putStockSnapshot,refreshStockCards} from '../../../../lib/stock-sync';
import {isOpenBox,openBoxProduct} from '../../../../lib/open-box';
export async function POST(request:Request){let phase='catalog';try{
 await visitor(request);if(stockIntegrationPaused())return json({error:'МойСклад отключён.'},409);
 const recent=await stockSnapshot<any>('open-box-catalog');if(recent&&Date.now()-Date.parse(recent.checkedAt)<30000)return json({cached:true});
 const claim=crypto.randomUUID(),now=Date.now(),d=db();await d.prepare("INSERT OR IGNORE INTO cloud_refresh(id,payload,lease,token,updated) VALUES('open-box-import','{}',0,'',?)").bind(new Date().toISOString()).run();const lock=await d.prepare("UPDATE cloud_refresh SET lease=?,token=? WHERE id='open-box-import' AND lease<=?").bind(now+180000,claim,now).run();if(!lock.meta.changes)return json({error:'Каталог уже обновляется.'},409);try{return await withManualStockUpdate(async()=>{
 const base='https://api.moysklad.ru/api/remap/1.2/',token=(env as any).MOYSKLAD_TOKEN,rows:any[]=[];
 // Explicit catalogue discovery only. Opening cards never scans assortment.
 for(let offset=0;offset<5000;offset+=1000){const data:any=await stockRequest(base+'entity/assortment?'+new URLSearchParams({filter:'name~MacBook',limit:'1000',offset:String(offset)}),token,{lightAssortment:true});if(!Array.isArray(data.rows)||!Number.isInteger(data.meta?.size)||data.meta.size>5000)throw Error('Invalid assortment size '+String(data.meta?.size));rows.push(...data.rows);if(offset+data.rows.length>=data.meta.size)break;}
 const candidates=rows.filter(r=>isOpenBox((r.name||'')+' '+(r.pathName||'')));
 phase='currency';const currencies:any=await stockRequest(base+'entity/currency?limit=100',token);const byId=new Map((currencies.rows||[]).map((c:any)=>[c.id||c.meta?.href?.split('?')[0].split('/').at(-1),c]));for(const row of candidates)for(const p of row.salePrices||[])p.currency=byId.get(p.currency?.id||p.currency?.meta?.href?.split('?')[0].split('/').at(-1))||p.currency;
 const exchange=await stockSnapshot<any>('exchange-rate'),rate=Number(exchange?.rate);const at=new Date().toISOString(),products=candidates.map(r=>openBoxProduct(r,at,rate)).filter((p):p is Product=>!!p);
 if(products.length&&!products.some(p=>p.price))console.info('Open Box price formats',JSON.stringify({currencies:(currencies.rows||[]).map((c:any)=>({name:c.name,code:c.code,isoCode:c.isoCode})),types:[...new Set(candidates.flatMap(r=>(r.salePrices||[]).map((p:any)=>p.priceType?.name)))],sample:candidates.filter(r=>/MDVQ4/.test(r.name||'')).map(r=>({name:r.name,prices:(r.salePrices||[]).filter((p:any)=>/роздр|рознич|розница|retail/i.test(p.priceType?.name||'')).map((p:any)=>({type:p.priceType?.name,value:p.value,currency:p.currency?.isoCode||p.currency?.name||p.currency?.meta?.href}))}))}));
 const old=await stockSnapshot<any>('open-box-catalog');const known=new Set(products.map(p=>p!.stock_id));for(const p of old?.products||[])if(!known.has(p.stock_id))products.push({...p,status:'unavailable'});
 phase='save';const current=await cloudCatalog(),calculated=priceOpenBoxes([...current.products.filter(p=>!p.stock_id),...products],rate,exchange?.checked_at);const history=await priceHistoryStatements(current.products,calculated.filter(p=>p.stock_id),claim,'open-box-import');await db().batch([...history,db().prepare('INSERT INTO snapshots(id,payload,updated) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated=excluded.updated').bind('open-box-catalog',JSON.stringify({products,checkedAt:at}),at)]);phase='stock';const stock=products.length?await refreshStockCards(products,false):null;
 return json({products:products.map(p=>({title:p!.full_title,price:p!.price,stock_id:p!.stock_id})),stock});
 });}finally{await d.prepare("UPDATE cloud_refresh SET lease=0 WHERE id='open-box-import' AND token=?").bind(claim).run();}
 }catch(e){console.error('Open Box import failed',phase,e instanceof Error?e.message:'unknown');return json({error:'Не удалось обновить Open Box ('+phase+'). Последние данные сохранены.'},503);}}
