import {identity,json,failure} from '../../../../lib/auth';
import {claimOwner} from '../../../../lib/admin';
export async function POST(request:Request){try{const user=await identity(request);const text=await request.text();if(text.length>1000)return json({error:'Request too large'},413);const {code}=JSON.parse(text);if(typeof code!=='string'||code.length>200)return json({error:'Неверный код'},400);return json({settings:await claimOwner(user,code),isOwner:true,ownerConfigured:true});}catch(e:any){if(e.message.includes('Telegram'))return failure(e);return json({error:e.message},403);}}
