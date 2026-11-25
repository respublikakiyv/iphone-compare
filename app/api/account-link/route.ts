import {identity,db,json,failure} from '../../../lib/auth';
export async function POST(request:Request){try{
 const user=await identity(request),d=db();
 if(request.headers.get('X-Telegram-Init-Data')){
  const code=crypto.randomUUID().replaceAll('-','');await d.batch([d.prepare('DELETE FROM link_codes WHERE telegram_id=? OR expires<?').bind(user,Date.now()),d.prepare('INSERT INTO link_codes(code,telegram_id,expires) VALUES(?,?,?)').bind(code,user,Date.now()+600000)]);return json({code});
 }
 const web=request.headers.get('oai-authenticated-user-id');if(!web)return json({error:'Войдите через ChatGPT.'},401);
 const text=await request.text();if(text.length>1000)return json({error:'Invalid request'},400);const {code}=JSON.parse(text);if(!/^[a-f0-9]{32}$/.test(code))return json({error:'Неверный код связи.'},400);
 const result=await d.prepare('INSERT OR IGNORE INTO account_links(web_id,telegram_id) SELECT ?,telegram_id FROM link_codes WHERE code=? AND expires>?').bind(web,code,Date.now()).run();
 if(!result.meta.changes)return json({error:'Код истёк или аккаунт уже связан. Создайте новый код в Telegram.'},409);
 await d.prepare('DELETE FROM link_codes WHERE code=?').bind(code).run();return json({ok:true});
 }catch(e){return failure(e);}}
