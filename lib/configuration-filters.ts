import type {Product} from './catalog.ts';
import {hasPrice} from './catalog.ts';
import {hardwareTitle,hardwareFilters} from './product-selection.ts';
export const hardwareKeys=['deviceClass','tier','generation','screen','glass','network'] as const;
export type HardwareKey=typeof hardwareKeys[number];
export type HardwareChoice=Record<HardwareKey,string>;
export const emptyHardwareChoice:HardwareChoice={deviceClass:'',tier:'',generation:'',screen:'',glass:'',network:''};
export function screenGlass(p:Product){if(p.configuration?.schema===1&&p.configuration.glass)return p.configuration.glass;return /nano[\s-]?texture|нанотекстур/i.test(hardwareTitle(p.full_title||p.model))?'nano':'standard';}
export function ipadNetwork(p:Product){if(p.configuration?.schema===1&&p.configuration.network)return p.configuration.network;const title=hardwareTitle(p.full_title||p.model);return /cellular|celular|\bLTE\b|\b[345]G\b/i.test(title)?'cellular':/wi[\s-]?fi/i.test(title)?'wifi':p.variant_key?.split('|').find(v=>v==='wifi'||v==='cellular')||'unknown';}
export function watchBandType(p:Product){
 if(p.configuration?.schema===1&&p.configuration.bandType)return p.configuration.bandType;
 const title=hardwareTitle(p.full_title||p.model);
 const match=/\b(Titanium Milanese Loop|Braided Solo Loop|Sport Band|S\.\s*Band|Sport Loop|Ocean Band|Alpine Loop|Trail Loop|Milanese Loop|Solo Loop|Link Bracelet|Modern Buckle|Magnetic Link|Leather Link|FineWoven|Herm[eè]s)\b/i.exec(title)?.[1];
 if(!match)return 'Не указан';
 const names=['Titanium Milanese Loop','Braided Solo Loop','Sport Band','Sport Loop','Ocean Band','Alpine Loop','Trail Loop','Milanese Loop','Solo Loop','Link Bracelet','Modern Buckle','Magnetic Link','Leather Link','FineWoven','Hermès'];
 return /S\.\s*Band/i.test(match)?'Sport Band':names.find(n=>n.toLowerCase()===match.toLowerCase())||'Hermès';
}
export function selectHardware(products:Product[],facts:Map<Product,ReturnType<typeof hardwareFilters>>,category:string,choice:HardwareChoice){
 let matching=products;
 const values={...emptyHardwareChoice},options:Record<HardwareKey,string[]>={deviceClass:[],tier:[],generation:[],screen:[],glass:[],network:[]};
 const fact=(p:Product,key:HardwareKey)=>key==='glass'?screenGlass(p):key==='network'?ipadNetwork(p):facts.get(p)![key];
 for(const key of hardwareKeys){
  if(key==='tier'&&(category==='ipad'||values.deviceClass==='Neo'))continue;
  if(key==='glass'&&!(category==='mac'&&values.deviceClass==='Pro'))continue;
  if(key==='network'&&category!=='ipad')continue;
  let available=[...new Set(matching.filter(p=>hasPrice(p)||p.edition==='OpenBox').map(p=>fact(p,key)))];
  if(key==='tier'&&values.deviceClass==='Pro'&&category==='mac')available=available.filter(v=>v!=='Базовый');
  options[key]=available.sort((a,b)=>key==='generation'?a==='Не указан'?1:b==='Не указан'?-1:b.localeCompare(a,undefined,{numeric:true}):key==='tier'?['Базовый','Pro','Max','Ultra'].indexOf(a)-['Базовый','Pro','Max','Ultra'].indexOf(b):key==='glass'?a==='standard'?-1:1:key==='network'?a==='wifi'?-1:b==='wifi'?1:a.localeCompare(b):a.localeCompare(b,undefined,{numeric:true}));
  values[key]=options[key].includes(choice[key])?choice[key]:options[key][0]||'';
  matching=matching.filter(p=>fact(p,key)===values[key]);
 }
 return {values,options,products:matching};
}
