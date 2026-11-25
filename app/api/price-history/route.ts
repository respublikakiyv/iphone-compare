import {priceOpenBoxes} from '../../../lib/open-box-pricing';
import {visitor,json,failure} from '../../../lib/auth';
import {cloudCatalog} from '../../../lib/cloud-refresh';
import {readPriceHistory} from '../../../lib/price-history';
export async function GET(request:Request){try{await visitor(request);const q=new URL(request.url).searchParams,store=q.get('store'),url=q.get('url');if(!url||url.length>2000||!store||store.length>40)return json({error:'Invalid product'},400);const catalog=await cloudCatalog();const rate=q.get('rate');if(rate&&(!Number.isFinite(Number(rate))||Number(rate)<1||Number(rate)>1000))return json({error:'Invalid rate'},400);const products=rate?priceOpenBoxes(catalog.products,rate,new Date().toISOString()):catalog.products;const p=products.find(p=>p.store===store&&p.url===url);if(!p)return json({error:'Товар не найден в базе.'},404);return json({points:await readPriceHistory(p)});}catch(e){return failure(e);}}
