import { env } from 'cloudflare:workers';
import { telegramIdentity } from './telegram';
export async function identity(request:Request){
 const origin=request.headers.get('Origin');if(request.method!=='GET'&&origin&&origin!==new URL(request.url).origin)throw new Error('Unauthorized');
 const data=request.headers.get('X-Telegram-Init-Data');
 if(data)return telegramIdentity(data,(env as any).TELEGRAM_BOT_TOKEN||'');
 const web=request.headers.get('oai-authenticated-user-id');
 if(web){const linked=await db().prepare('SELECT telegram_id FROM account_links WHERE web_id=?').bind(web).first<any>();return linked?.telegram_id||'chatgpt:'+web;}
 throw new Error('Unauthorized');
}
export function internal(request:Request){const key=(env as any).SYNC_WORKER_KEY;if(!key||request.headers.get('X-Sync-Key')!==key)throw new Error('Unauthorized');}
export function db(){if(!env.DB)throw new Error('Database unavailable');return env.DB;}
export function json(value:any,status=200){return Response.json(value,{status,headers:{'Cache-Control':'no-store'}});}
export function failure(error:any){return json({error:(error.message==='Open in Telegram'||error.message==='Unauthorized')?'Войдите через ChatGPT или откройте приложение в Telegram.':'Запрос не выполнен. Обновите приложение.'},error.message?.includes('Unauthorized')||error.message?.includes('Telegram')?401:503);}

// Public catalog operations do not require an account; owner operations still use identity().
export async function visitor(request:Request){
 const origin=request.headers.get('Origin');if(request.method!=='GET'&&origin&&origin!==new URL(request.url).origin)throw Error('Unauthorized');
 if(!request.headers.get('X-Telegram-Init-Data')&&!request.headers.get('oai-authenticated-user-id'))return 'public';
 try{return await identity(request);}catch{return 'public';}
}
