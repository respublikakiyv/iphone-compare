import type {load} from 'cheerio/slim';
export function structuredData($:ReturnType<typeof load>){
 const out:any[]=[];let visited=0;
 function add(v:any,depth=0){if(depth>8||++visited>1000||!v||typeof v!=='object')return;if(Array.isArray(v)){v.slice(0,100).forEach(x=>add(x,depth+1));return;}out.push(v);if(v['@graph'])add(v['@graph'],depth+1);}
 $('script[type="application/ld+json"]').each((_,e)=>{try{add(JSON.parse($(e).text()));}catch{}});return out;
}
export const schemaType=(value:any,type:string)=>value?.['@type']===type||Array.isArray(value?.['@type'])&&value['@type'].includes(type);
