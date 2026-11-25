const bytes=(s:string)=>new TextEncoder().encode(s);
const hex=(b:ArrayBuffer)=>Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,'0')).join('');
async function hmac(key:Uint8Array<ArrayBuffer>,message:string){const k=await crypto.subtle.importKey('raw',key,{name:'HMAC',hash:'SHA-256'},false,['sign']);return crypto.subtle.sign('HMAC',k,bytes(message));}
export async function telegramIdentity(data:string,token:string,now=Math.floor(Date.now()/1000)){
 if(!data||data.length>20000||!token) throw new Error('Unauthorized');
 const p=new URLSearchParams(data);const hash=p.get('hash');p.delete('hash');
 if(!hash||!(/^[a-f0-9]{64}$/.test(hash))) throw new Error('Unauthorized');
 const keys=[...p.keys()];if(new Set(keys).size!==keys.length)throw new Error('Unauthorized');
 const check=[...p.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');
 const secret=await hmac(bytes('WebAppData'),token);const expected=hex(await hmac(new Uint8Array(secret),check));
 let delta=0;for(let i=0;i<64;i++)delta|=expected.charCodeAt(i)^hash.charCodeAt(i);if(delta)throw new Error('Unauthorized');
 const date=Number(p.get('auth_date'));if(!Number.isSafeInteger(date)||date>now+30||now-date>86400)throw new Error('Expired Telegram session');
 const user=JSON.parse(p.get('user')||'{}');if(!Number.isSafeInteger(user.id)||user.id<=0)throw new Error('Unauthorized');
 return `telegram:${user.id}`;
}
