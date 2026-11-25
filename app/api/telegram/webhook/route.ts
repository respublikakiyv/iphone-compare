import {db,json} from '../../../../lib/auth';
import {botApi,webhookSecret} from '../../../../lib/telegram-bot';
export async function POST(request:Request){
 if(request.headers.get('X-Telegram-Bot-Api-Secret-Token')!==await webhookSecret())return json({error:'Unauthorized'},401);
 try{const text=await request.text();if(text.length>100000)return json({ok:true});const update=JSON.parse(text);if(!Number.isSafeInteger(update.update_id))return json({ok:true});const m=update.message;if(m?.chat?.type!=='private'||!/^\/(start|app)(?:@\w+)?(?:\s|$)/.test(m.text||''))return json({ok:true});
 const d=db();await d.prepare('CREATE TABLE IF NOT EXISTS bot_updates(id INTEGER PRIMARY KEY,expires INTEGER NOT NULL,state TEXT NOT NULL)').run();await d.prepare('DELETE FROM bot_updates WHERE expires<?').bind(Date.now()-86400000).run();const inserted=await d.prepare("INSERT INTO bot_updates(id,expires,state) VALUES(?,?,'sending') ON CONFLICT(id) DO UPDATE SET expires=excluded.expires,state='sending' WHERE bot_updates.state!='done' AND bot_updates.expires<?").bind(update.update_id,Date.now()+60000,Date.now()).run();if(!inserted.meta.changes)return json({ok:true});
 try{await botApi('sendMessage',{chat_id:m.chat.id,text:'Сравнение цен iPeople и Jabko. Откройте приложение:',reply_markup:{inline_keyboard:[[{text:'Открыть приложение',web_app:{url:new URL(request.url).origin}}]]}});await d.prepare("UPDATE bot_updates SET state='done',expires=? WHERE id=?").bind(Date.now()+86400000,update.update_id).run();}catch(e){await d.prepare("DELETE FROM bot_updates WHERE id=? AND state='sending'").bind(update.update_id).run();throw e;}return json({ok:true});
 }catch{return json({error:'Temporary failure'},503);}
}
