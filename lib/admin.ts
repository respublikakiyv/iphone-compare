import {env} from 'cloudflare:workers';
import {db} from './auth';
import {defaultSettings,validateSettings,migrateAppSettings} from './app-settings';
export async function configuration(){const d=db();await d.prepare('CREATE TABLE IF NOT EXISTS app_admin(id INTEGER PRIMARY KEY CHECK(id=1),owner TEXT NOT NULL,payload TEXT NOT NULL,revision INTEGER NOT NULL)').run();return d.prepare('SELECT * FROM app_admin WHERE id=1').first<any>();}
export function publicSettings(row:any){return row?migrateAppSettings({...JSON.parse(row.payload),revision:row.revision}):defaultSettings;}
export async function requireOwner(user:string){const row=await configuration();if(!row||row.owner!==user)throw Error('Forbidden');return row;}
async function equalSecret(a:string,b:string){const digest=async(v:string)=>new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)));const [x,y]=await Promise.all([digest(a),digest(b)]);let diff=0;for(let i=0;i<x.length;i++)diff|=x[i]^y[i];return diff===0;}
export async function claimOwner(user:string,code:string){
 const d=db();if(await configuration())throw Error('Владелец уже настроен.');
 await d.prepare('CREATE TABLE IF NOT EXISTS admin_claim_attempts(user TEXT PRIMARY KEY,window INTEGER NOT NULL,attempts INTEGER NOT NULL)').run();
 const window=Math.floor(Date.now()/3600000);const attempt=await d.prepare('INSERT INTO admin_claim_attempts(user,window,attempts) VALUES(?,?,1) ON CONFLICT(user) DO UPDATE SET window=excluded.window,attempts=CASE WHEN window=excluded.window THEN attempts+1 ELSE 1 END RETURNING attempts').bind(user,window).first<any>();
 if(attempt.attempts>8)throw Error('Слишком много попыток. Повторите через час.');
 const expected=(env as any).ADMIN_SETUP_CODE;if(!expected||!await equalSecret(code,expected))throw Error('Неверный код владельца.');
 const result=await d.prepare('INSERT OR IGNORE INTO app_admin(id,owner,payload,revision) VALUES(1,?,?,1)').bind(user,JSON.stringify({...defaultSettings,revision:1})).run();if(!result.meta.changes)throw Error('Владелец уже настроен.');
 return {...defaultSettings,revision:1};
}
export async function saveSettings(user:string,value:any){const row=await requireOwner(user);const next=validateSettings(value);if(next.revision!==row.revision)throw Error('Настройки изменились. Откройте панель заново.');next.revision++;const result=await db().prepare('UPDATE app_admin SET payload=?,revision=? WHERE id=1 AND owner=? AND revision=?').bind(JSON.stringify(next),next.revision,user,row.revision).run();if(!result.meta.changes)throw Error('Настройки изменились. Откройте панель заново.');return next;}
