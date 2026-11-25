import {stockIntegrationPaused,stockManualOnly,stockRealtimeEnabled,stockOnOpenEnabled,stockPausedMessage,withManualStockUpdate} from '../../../lib/stock-integration';
import {refreshStockCards,refreshStockView,syncStock} from '../../../lib/stock-sync';
import {visitor,json,failure} from '../../../lib/auth';
import {cloudCatalog} from '../../../lib/cloud-refresh';
import {categoryOf,comparisonCompatible} from '../../../lib/apple-products';
import {selectionModel} from '../../../lib/product-selection';
import {belongs} from '../../../lib/inventory';
import {stockProductKey,type CardStock} from '../../../lib/warehouse-stock';
import {background} from '../../../lib/background';
import {reconcileOpenStock} from '../../../lib/stock-webhook';
import {readStockBase,stockVersion} from '../../../lib/stock-base';
export async function GET(request:Request){try{
 await visitor(request);const q=new URL(request.url).searchParams,category=q.get('category'),model=q.get('model'),used=q.get('scope')==='used';
 const live=stockRealtimeEnabled(),version=await stockVersion(used),flags={version,integrationPaused:stockIntegrationPaused(),manualOnly:stockManualOnly(),realtime:live,onOpen:stockOnOpenEnabled()};
 if(live)background(reconcileOpenStock);
 if(q.get('version')===version)return json({...flags,unchanged:true});
 if(used){const {targets,...base}=await readStockBase();return json({...base,...flags});}
 if((!model&&!['mac','ipad'].includes(category||''))||(model&&model.length>160))return json({values:{}},400);
 const catalog=await cloudCatalog(),products=catalog.products.filter(p=>belongs(p,'new')&&categoryOf(p)===category&&(!model||selectionModel(p)===model));
 if(!products.length)return json({...flags,values:{},verifiedAt:{}});
 const {targets,...base}=await readStockBase(false);const values:Record<string,CardStock>={};
 for(const p of products)values[stockProductKey(p)]=base.values[stockProductKey(p)]||[null,null,null];
 return json({...base,values,verifiedAt:Object.fromEntries(Object.keys(values).map(key=>[key,base.verifiedAt?.[key]||[null,null,null]])),...flags});
 }catch(e){return failure(e);}}
export async function POST(request:Request){try{
 await visitor(request);if(stockIntegrationPaused())return json({paused:true,error:stockPausedMessage},409);const text=await request.text();if(text.length>80000)return json({error:'Invalid request'},400);
 const body=JSON.parse(text),used=body.scope==='used',catalog=await cloudCatalog();
 if(body.all===true){
  const result=await withManualStockUpdate(()=>syncStock('all'));return json(result);
 }
 if(!Array.isArray(body.targets)||!body.targets.length||body.targets.length>(body.view===true?300:48))return json({error:'Invalid card'},400);
 const products=body.targets.map((t:any)=>catalog.products.find(p=>p.store===t.store&&p.url===t.url&&belongs(p,used?'used':'new')));
 if(products.some((p:any)=>!p))return json({error:'Unknown card'},400);
 const first=products[0];if(body.view===true){
  if(products.some((p:any)=>categoryOf(p)!==categoryOf(first)))return json({error:'Invalid view'},400);
  for(let i=0;i<products.length;i++)if(products[i].sim==='unknown'&&['physical','esim'].includes(body.sim))products[i]={...products[i],sim:body.sim};
  return json(await withManualStockUpdate(()=>refreshStockView(products,used)));
 }
 if(products.some((p:any)=>categoryOf(first)==='iphone'?p.model!==first.model||p.storage!==first.storage||p.color!==first.color||(p.edition||'Standard')!==(first.edition||'Standard')||p.sim!==first.sim&&p.sim!=='unknown'&&first.sim!=='unknown':!comparisonCompatible(first,p)))return json({error:'Invalid card'},400);
 for(let i=0;i<products.length;i++)if(products[i].sim==='unknown'&&['physical','esim'].includes(body.sim))products[i]={...products[i],sim:body.sim};
 const result=await withManualStockUpdate(()=>refreshStockCards(products,used));
 if(result.unmapped===products.length)return json({error:'Не удалось сопоставить эту карточку с МойСкладом. Сохранённые остатки не изменены.'},409);
 return json(result);
 }catch(e){return failure(e);}}
