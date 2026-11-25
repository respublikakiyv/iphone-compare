import type {Product} from './catalog.ts';
import {comparisonArticle,categoryOf} from './apple-products.ts';
import {equipmentColor,hardwareFilters,hardwareRam,hardwareTitle} from './product-selection.ts';
import {ipadNetwork,watchBandType} from './configuration-filters.ts';
import type {CanonicalFields,ConfigurationRegistry} from './configuration-types.ts';
export type {ConfigurationRegistry} from './configuration-types.ts';
export function configurationId(p:Product){const article=comparisonArticle(p);return article?categoryOf(p)+'|'+article:null;}
function observed(p:Product):CanonicalFields{
 const category=categoryOf(p),title=hardwareTitle(p.full_title||p.model),hardware=['mac','ipad'].includes(category)?hardwareFilters(p):null;
 const fields:CanonicalFields={storage:p.storage==='—'?'':p.storage,color:equipmentColor(p).toLowerCase().replace(/\b[a-z]/g,c=>c.toUpperCase())};
 if(hardware){fields.deviceClass=hardware.deviceClass;fields.generation=hardware.generation==='Не указан'?'':hardware.generation;fields.chipVariant=fields.generation?hardware.tier:'';fields.diagonal=hardware.screen==='Не указана'?'':hardware.screen;fields.ram=hardwareRam(p);fields.glass=/nano[\s-]?texture|нанотекстур/i.test(title)?'nano':/standard glass|стандартн[\p{L}\s]*(?:скло|стекло)|обычн[\p{L}\s]*(?:скло|стекло)/iu.test(title)?'standard':undefined;}
 if(category==='ipad'){const network=ipadNetwork(p);if(network==='wifi'||network==='cellular')fields.network=network;}
 if(category==='watch'){const band=watchBandType(p);fields.bandType=band==='Не указан'?'':band;fields.watchSize=/\b(\d{2})\s*mm\b/i.exec(title)?.[1];fields.bandFit=/\b(?:S\/M|M\/L|XS\/S|S\/L)\b/i.exec(title)?.[0]?.toUpperCase();}
 for(const m of title.matchAll(/(\d+)[\s-]*(?:C|cores?)?[\s-]*(CPU|GPU)\b/ig))fields[m[2].toLowerCase() as 'cpu'|'gpu']=m[1];
 return fields;
}
function modelLabel(category:string,f:CanonicalFields){
 if(!f.deviceClass)return undefined;
 const family=category==='ipad'?f.deviceClass==='iPad'?'iPad':'iPad '+f.deviceClass:category==='mac'?['Air','Pro','Neo'].includes(f.deviceClass)?'MacBook '+f.deviceClass:['mini','Studio'].includes(f.deviceClass)?'Mac '+f.deviceClass:f.deviceClass:'';
 if(!family)return undefined;if(f.deviceClass==='Neo')return family;
 return [family,f.diagonal,f.generation,f.chipVariant&&f.chipVariant!=='Базовый'?f.chipVariant:''].filter(Boolean).join(' ');
}
export function buildConfigurationRegistry(products:Product[],version:string):ConfigurationRegistry{
 const groups=new Map<string,Product[]>();for(const p of products){const id=configurationId(p);if(id)groups.set(id,[...(groups.get(id)||[]),p]);}
 const records:ConfigurationRegistry['records']={};
 for(const [id,offers]of groups){const category=categoryOf(offers[0]),facts=offers.map(p=>observed({...p,configuration:undefined})),fields:CanonicalFields={},conflicts:string[]=[];
  const names=[...new Set(facts.flatMap(f=>Object.keys(f)))] as (keyof CanonicalFields)[];
  for(const name of names){const values=[...new Set(facts.map(f=>f[name]).filter((v):v is string=>!!v))];if(values.length===1)(fields as any)[name]=values[0];else if(values.length>1)conflicts.push(name);}
  if(!conflicts.length)fields.modelLabel=modelLabel(category,fields);
  records[id]={id,category,article:comparisonArticle(offers[0])!,fields,conflicts,sources:[...new Set(offers.map(p=>p.store+'|'+p.url))]};
 }
 return {schema:1,catalogVersion:version,createdAt:new Date().toISOString(),records};
}
export function applyConfigurationRegistry(products:Product[],registry:ConfigurationRegistry|null){
 if(!registry||registry.schema!==1)return products;
 return products.map(p=>{const id=configurationId(p),record=id?registry.records[id]:null;if(!record||record.conflicts.length||['mac','ipad'].includes(categoryOf(p))&&!record.fields.deviceClass)return p;
  return {...p,storage:record.fields.storage||p.storage,configuration:{schema:1 as const,id:record.id,...record.fields}};
 });
}

// Price/status/checkpoint updates do not change the configuration dictionary.
export function configurationRevision(products:Product[]){
 let a=2166136261,b=2246822519;const lines=products.map(p=>JSON.stringify([p.category||'iphone',p.store,p.url,p.sku,p.model,p.full_title,p.storage,p.color,p.sim])).sort();
 for(const line of lines)for(let i=0;i<line.length;i++){const n=line.charCodeAt(i);a=Math.imul(a^n,16777619)>>>0;b=Math.imul(b^n,3266489917)>>>0;}
 return 'config-v1:'+products.length+':'+a.toString(16)+b.toString(16);
}
