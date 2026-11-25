import type {Product} from './catalog.ts';
import {categoryOf} from './apple-products.ts';
export function selectionModel(p:Product){
 if(p.configuration?.schema===1&&p.configuration.modelLabel)return p.configuration.modelLabel;
 const category=categoryOf(p);if(category==='iphone')return p.model;
 const title=hardwareTitle(p.full_title||p.model);
 const family=category==='ipad'?/iPad(?:\s+(?:Air|Pro|mini))?(?:\s+\d+(?:\.\d+)?)?/i.exec(title)?.[0]:category==='mac'?/(?:MacBook\s+(?:Air|Pro|Neo)|iMac|Mac\s+(?:mini|Studio|Pro)|Studio Display|Pro Display)(?:\s+\d+(?:\.\d+)?)?/i.exec(title)?.[0]:category==='watch'?/Watch(?:\s+(?:Series|Ultra|SE))?(?:\s+\d+)?/i.exec(title)?.[0]:category==='airpods'?/AirPods(?:\s*(?:Pro|Max))?(?:\s*\d+)?/i.exec(title)?.[0]:/(?:HomePod|Apple TV|AirTag|Apple Pencil|Magic\s+(?:Keyboard|Mouse|Trackpad)|Vision Pro)(?:\s+(?:mini|Pro|\d+|4K))?/i.exec(title)?.[0];
 const chip=/\bM\d+(?:\s+(?:Pro|Max|Ultra))?\b/i.exec(title)?.[0];
 const size=['ipad','mac'].includes(category)?/(?:^|[\s,(])(1[013456]|2[147])(?:[.,]\d)?(?=\s*(?:[\"'″]|inch|Retina|M[1-9]\b|20\d{2}\b|,|$))/i.exec(title)?.[1]:null;
 let model=family?.replace(/(\d+)\.\d+/g,'$1').replace(/^Mac Mini/i,'Mac mini');
 // Capacity digits are never a screen size (e.g. MacBook Neo 512GB).
 model=model?.replace(/\s+\d+$/,m=>Number(m.trim())>30?'':m);
 if(category==='watch')model=model?.replace(/^Watch (\d+)/,'Watch Series $1');
 if(size&&model&&!/\d/.test(model))model+=' '+size;
 if(category==='mac'&&/MacBook Neo/i.test(model||''))model='MacBook Neo';
 return [model,(['ipad','mac'].includes(category)?chip:null)].filter(Boolean).join(' ')||p.model;
}

export function macbookRam(p:Product){return categoryOf(p)==='mac'&&/\bMacBook\b/i.test(p.full_title||p.model)?hardwareRam(p):'';}
export function hardwareRam(p:Product){
 if(p.configuration?.schema===1&&p.configuration.ram)return p.configuration.ram;
 if(!['mac','ipad'].includes(categoryOf(p)))return '';
 const title=hardwareTitle(p.full_title||p.model);
 const compact=/(?:^|[\s/])(8|12|16|18|24|32|36|48|64|96|128|192|256)\s*\/\s*(256|512|1024|[1248])\s*(GB|TB|ГБ|ТБ)(?![\p{L}\p{N}])/iu.exec(title);
 if(compact)return compact[1]+'GB';
 const explicit=/(\d+)\s*(?:GB|ГБ)\s*(?:RAM|unified memory|оперативн)/iu.exec(title)||/(?:RAM|оперативн[\p{L}\s’'ь]*[:\s])\s*(\d+)\s*(?:GB|ГБ)/iu.exec(title);
 if(explicit)return explicit[1]+'GB';
 const storage=/^(\d+)\s*(GB|TB)$/i.exec(p.storage),ssd=storage?Number(storage[1])*(storage[2].toUpperCase()==='TB'?1024:1):null;
 const sizes=[...new Set([...title.matchAll(/(\d+)\s*(GB|TB|ГБ|ТБ)(?![\p{L}\p{N}])/igu)].map(m=>Number(m[1])*(/TB|ТБ/i.test(m[2])?1024:1)))];
 // Only infer RAM when a separate, known SSD capacity is present in the title.
 if(ssd===null||!sizes.includes(ssd))return '';
 const candidates=sizes.filter(n=>n!==ssd&&n>=4&&n<=256);
 return candidates.length===1?candidates[0]+'GB':'';
}

// Retailers mix Latin M and Cyrillic М in Apple silicon names.
export const hardwareTitle=(title:string)=>title.replace(/[\u2010-\u2015\u2212]/g,'-').replace(/М(?=[1-9]\b)/g,'M').replace(/\bGrey\b/ig,'Gray');
export function equipmentColor(p:Product){
 if(p.configuration?.schema===1&&p.configuration.color)return p.configuration.color;
 const title=hardwareTitle(p.full_title||p.model),watch=categoryOf(p)==='watch';
 // Watch titles can put the band before the case colour. The band colour is
 // a separate fact and must never become the colour of the watch case.
 const caseTitle=watch?title.replace(/(?:[A-Za-z]+[ -]){0,3}(?:Sport Band|S\. Band|Ocean Band|Alpine Loop|Trail Loop|Milanese Loop)/ig,''):title;
 const colors=/\b(?:Natural Titanium|Black Titanium|White Titanium|Blue Titanium|Space Gray|Space Black|Sky Blue|Rose Gold|Light Gold|Dark Bronze|Jet Black|Midnight|Starlight|Silver|White|Black|Blue|Pink|Purple|Gold|Green|Orange|Citrus|Indigo|Blush|Yellow|Red|Coral|Teal)\b/i.exec(caseTitle)?.[0];
 if(watch&&colors)return colors;
 if(p.color&&p.color!=='—')return p.color==='Space Grey'?'Space Gray':p.color;
 const aliases:Record<string,string>={'космічний сірий':'Space Gray','серый космос':'Space Gray','космический серый':'Space Gray','космічний чорний':'Space Black','космический черный':'Space Black','чёрный космос':'Space Black','небесно-блакитний':'Sky Blue','небесно-голубой':'Sky Blue','зіркове сяйво':'Starlight','сияющая звезда':'Starlight','темная ночь':'Midnight','жовтий':'Yellow','желтый':'Yellow','сріблястий':'Silver','серебристый':'Silver','темна ніч':'Midnight','сяюча зірка':'Starlight','чорний онікс':'Jet Black','темна бронза':'Dark Bronze','світле золото':'Light Gold','натуральний титан':'Natural Titanium','білий':'White','чорний':'Black','сірий космос':'Space Gray','блакитний':'Blue','синій':'Blue','рожевий':'Pink','фіолетовий':'Purple'};
 return Object.entries(aliases).find(([name])=>caseTitle.toLowerCase().includes(name))?.[1]||colors||'';
}

export function hardwareFilters(p:Product){
 const known=p.configuration;if(known?.schema===1&&known.deviceClass)return {deviceClass:known.deviceClass,generation:known.generation||'Не указан',tier:known.chipVariant||'Базовый',screen:known.diagonal||''};
 const category=categoryOf(p),title=hardwareTitle(p.full_title||p.model);
 const family=category==='mac'?/\b(MacBook\s+(?:Air|Pro|Neo)|Mac\s+(?:mini|Studio|Pro)|iMac|Studio Display|Pro Display)\b/i.exec(title)?.[1]:/\biPad(?:\s+(Air|Pro|mini))?\b/i.exec(title)?.[0];
 const className=(family||p.model).replace(/^MacBook\s+/i,'').replace(/^Mac\s+(mini|Studio)$/i,'$1').replace(/^iPad\s+/i,'').replace(/^mac pro$/i,'Mac Pro');
 const deviceClass=({air:'Air',pro:'Pro',neo:'Neo',mini:'mini',studio:'Studio',imac:'iMac',ipad:'iPad','mac pro':'Mac Pro','studio display':'Studio Display','pro display':'Pro Display'} as Record<string,string>)[className.toLowerCase()]||className;
 // iPad mini generations: https://support.apple.com/en-us/121456 and /111886.
 const miniVersion=category==='ipad'&&deviceClass==='mini'?/\biPad\s+mini\s+([67])\b/i.exec(title)?.[1]:null;
 const chip=/\b([MA]\d+)(?:\s+(Pro|Max|Ultra))?\b/i.exec(title)||(miniVersion?['',miniVersion==='7'?'A17':'A15',miniVersion==='7'?'Pro':'']:null);
 const rawSize=/(?:^|[\s,(])((?:[78]|1[0-6]|2[147]|32)(?:[.,]\d)?)(?=\s*(?:["'″”]|inch|дюйм|Retina|Liquid|M\d\b|20\d{2}\b|,|$))/i.exec(title)?.[1];
 // Match retailer decimals to the familiar screen sizes in the selector.
 const adjacent=/(?:MacBook\s+(?:Pro|Air)|iMac|(?:Studio|Pro) Display|iPad(?:\s+(?:Pro|Air))?)\s+((?:1[013456]|2[147]|32)(?:[.,]\d)?)(?![\d.,])/i.exec(title)?.[1];
 const miniDiagonal=category==='ipad'&&deviceClass==='mini'&&(miniVersion||chip&&['A15','A17'].includes(chip[1].toUpperCase()))?'8.3':'';
 const diagonal=miniDiagonal||rawSize||adjacent;
 const screen=diagonal?(category==='mac'?String(Math.floor(Number(diagonal.replace(',','.')))):diagonal.replace(',','.')):'';
 const generation=chip?.[1].toUpperCase()||'Не указан';
 return {deviceClass,generation,tier:chip?.[2]?chip[2][0].toUpperCase()+chip[2].slice(1).toLowerCase():'Базовый',screen:deviceClass==='Neo'||!/MacBook|iPad|iMac|Display/i.test(family||'')?'':screen||'Не указана'};
}
export function modernMac(p:Product){const f=hardwareFilters(p);return /^M(?:[4-9]|[1-9]\d+)$/.test(f.generation)||f.deviceClass==='Neo'||/Display/.test(f.deviceClass);}

// Fill omitted facts only from agreeing offers for the same manufacturer article.
export function hardwareCatalog(products:Product[]){
 const facts=new Map(products.map(p=>[p,hardwareFilters(p)]));
 const articles=new Map<string,Product[]>();
 for(const p of products){const article=(p.sku||/\(([A-Z][A-Z0-9]{4,11}(?:\/[A-Z])?)\)/.exec(p.full_title||p.model)?.[1])?.toUpperCase().replace(/^(M[A-Z0-9]{4})[A-Z0-9]{2}\/A$/,'$1');if(article){const key=categoryOf(p)+'|'+article;articles.set(key,[...(articles.get(key)||[]),p]);}}
 for(const group of articles.values())for(const p of group){const f=facts.get(p)!;for(const key of ['tier','generation','screen'] as const){const known=[...new Set(group.map(other=>facts.get(other)!).filter(other=>other.deviceClass===f.deviceClass&&(key!=='tier'||other.generation!=='Не указан')).map(other=>other[key]).filter(v=>v&&v!=='Не указан'&&v!=='Не указана'))];if(known.length===1&&(key==='tier'?f.generation==='Не указан':!f[key]||f[key]==='Не указан'||f[key]==='Не указана'))f[key]=known[0];}}
 return facts;
}

export function colorHex(color:string){
 const colors:Record<string,string>={'black':'#333438','white':'#f3f1e9','silver':'#e4e5e7','sage':'#bdc9ab','mist blue':'#becedd','lavender':'#c5bddd','black titanium':'#49494b','natural titanium':'#b9b1a7','desert titanium':'#cfb79f','white titanium':'#dddcd7','blue titanium':'#586775','burgundy':'#673e4d','glacier':'#b6d7dd','glacier blue':'#b6d7dd','deep blue':'#36435b','cosmic orange':'#de8b4d','space gray':'#777980','space black':'#303134','sky blue':'#b9cddd','midnight':'#303b49','starlight':'#e9dfcc','blue':'#8cabc3','pink':'#e6bbce','purple':'#b9aed0','gold':'#dfc9a7','rose gold':'#dfb9ad','yellow':'#f1dc78','green':'#a9c6b6','orange':'#dc915f','citrus':'#dbe59b','indigo':'#565f96','blush':'#e9bbc3','light gold':'#e7d8ba','dark bronze':'#7d6c60','jet black':'#242528','red':'#c93c42','coral':'#ed8b7d','teal':'#81aaa5'};
 return colors[color.trim().replace(/grey/ig,'gray').toLowerCase()]||'#c3c3ca';
}
