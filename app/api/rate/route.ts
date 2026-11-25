import {fetchExchangeRate} from '../../../lib/exchange-rate';
import { visitor,db,json,failure } from '../../../lib/auth';
export async function POST(request:Request){try{const user=await visitor(request);const {rate}=await request.json() as any;const n=Number(String(rate).replace(',','.'));if(!Number.isFinite(n)||n<1||n>1000)return json({error:'Введите курс от 1 до 1000.'},400);const value=n.toFixed(4).replace(/0+$/,'').replace(/\.$/,'');if(user!=='public')await db().prepare('INSERT INTO preferences(user_id,rate,updated) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET rate=excluded.rate,updated=excluded.updated').bind(user,value,new Date().toISOString()).run();return json({rate:value});}catch(e){return failure(e);}}

export async function GET(request:Request){
 try{await visitor(request);}catch(e){return failure(e);}
 try{const result=await fetchExchangeRate();await db().prepare('INSERT INTO snapshots(id,payload,updated) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated=excluded.updated').bind('exchange-rate',JSON.stringify(result),new Date().toISOString()).run();return json(result);}
 catch{return json({error:'Не удалось обновить курс iPeople. Последний сохранённый курс оставлен.'},502);}
}
