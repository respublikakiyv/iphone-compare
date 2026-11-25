import {priceOpenBoxes} from './open-box-pricing';
import {db} from './auth';
import {cloudJob,publicJob} from './cloud-refresh';
import {unpackCatalog} from './catalog-storage.ts';
export async function catalogVersion(){const row=await db().prepare('SELECT updated FROM snapshots WHERE id=?').bind('catalog').first<{updated:string}>();const open=await db().prepare('SELECT updated FROM snapshots WHERE id=?').bind('open-box-catalog').first<{updated:string}>();return (row?.updated||'empty')+(open?'|'+open.updated+'|open-box-100-v1':'');}
export async function catalogMetadata(user:string){
 const d=db(),[version,preference,job,rate]=await Promise.all([catalogVersion(),d.prepare('SELECT rate,updated FROM preferences WHERE user_id=?').bind(user).first<any>(),cloudJob(),d.prepare('SELECT payload FROM snapshots WHERE id=?').bind('exchange-rate').first<any>()]);
 const shared=rate?JSON.parse(rate.payload):null,manual=preference&&(!shared||Date.parse(preference.updated)>Date.parse(shared.checked_at));
 return {catalogVersion:version,rate:manual?preference.rate:shared?.rate||null,rateSource:manual?null:shared?.source||null,rateCheckedAt:manual?null:shared?.checked_at||null,job:publicJob(job)};
}
export async function readCatalogState(user:string,version?:string|null){
 const metadata=await catalogMetadata(user);
 if(version&&version===metadata.catalogVersion)return {...metadata,catalogUnchanged:true};
 // Read payload and its version together: a refresh can commit after metadata was read.
 const row=await db().prepare('SELECT payload,updated FROM snapshots WHERE id=?').bind('catalog').first<{payload:string;updated:string}>();
 const open=await db().prepare('SELECT payload,updated FROM snapshots WHERE id=?').bind('open-box-catalog').first<{payload:string;updated:string}>(),catalog=row?await unpackCatalog(row.payload):{products:[],stores:{}};if(open)catalog.products.push(...JSON.parse(open.payload).products);catalog.products=priceOpenBoxes(catalog.products,metadata.rate,metadata.rateCheckedAt);return {...metadata,catalogVersion:(row?.updated||'empty')+(open?'|'+open.updated+'|open-box-100-v1':''),catalog};
}
